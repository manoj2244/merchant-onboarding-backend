import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';
import { ApplicationRiskStatus, ApplicationStatus } from '../applications/application.enums';
import { ApplicationAction, transition } from '../applications/domain/application-state-machine';
import { MerchantApplication } from '../applications/entities/merchant-application.entity';
import { AuditAction, AuditEntityType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { RiskAssessment } from './entities/risk-assessment.entity';
import { RISK_PROVIDER, RiskCheckResult, RiskProvider } from './providers/risk-provider.interface';
import { RiskJobData } from './risk-review.producer';
import { RISK_REVIEW_QUEUE } from './risk.constants';
import { RiskAssessmentStatus, TERMINAL_RISK_STATUSES } from './risk.enums';

type Outcome = 'completed' | 'skipped';

interface LockedPair {
  application: MerchantApplication;
  assessment: RiskAssessment;
}

/**
 * Consumes risk-review jobs. Guarantees:
 *  - Idempotent: a job for an assessment that is already CLEAR/FLAGGED/FAILED does nothing, so
 *    duplicate deliveries, duplicate enqueues or a retry after a crash cannot double-process.
 *  - Never decides: on success the application moves SUBMITTED → UNDER_REVIEW (state machine
 *    rule COMPLETE_RISK_REVIEW). Approval is reserved for the assigned human reviewer.
 *  - Retries: provider errors are re-thrown so BullMQ retries with exponential backoff; the final
 *    failed attempt marks the assessment FAILED, which an admin can retry later.
 *  - Lock order is always application → assessment (same as submit/retry), to avoid deadlocks.
 */
@Processor(RISK_REVIEW_QUEUE, { concurrency: 5 })
export class RiskReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(RiskReviewProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(RISK_PROVIDER) private readonly provider: RiskProvider,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<RiskJobData>): Promise<Outcome> {
    const { assessmentId } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const logCtx = { jobId: job.id, assessmentId, attempt, maxAttempts };

    const claimed = await this.markProcessing(assessmentId);
    if (!claimed) {
      this.logger.log({ ...logCtx, event: 'risk_job_skipped', reason: 'already_finished_or_missing' });
      return 'skipped';
    }

    let result: RiskCheckResult;
    try {
      const app = claimed.application;
      result = await this.provider.assess({
        applicationId: app.id,
        submissionNumber: claimed.assessment.submissionNumber,
        businessName: app.businessName,
        legalBusinessName: app.legalBusinessName,
        businessType: app.businessType,
        website: app.website,
        mcc: app.mcc,
        currency: app.currency,
        requestedMonthlyVolume: app.requestedMonthlyVolume,
        averageTicketSize: app.averageTicketSize,
      });
    } catch (err) {
      const isFinalAttempt = attempt >= maxAttempts;
      await this.recordFailure(assessmentId, err, isFinalAttempt);
      this.logger.warn({ ...logCtx, event: 'risk_job_attempt_failed', final: isFinalAttempt, error: errorMessage(err) });
      throw err; // let BullMQ apply retry/backoff (or move the job to failed)
    }

    const outcome = await this.complete(assessmentId, result);
    this.logger.log({ ...logCtx, event: 'risk_job_finished', outcome, result: result.outcome });
    return outcome;
  }

  /**
   * Worker-level errors (e.g. a lost Redis connection, a job removed while running). Without a
   * listener, Node treats an 'error' event as fatal and the whole process could crash.
   */
  @OnWorkerEvent('error')
  onWorkerError(err: Error): void {
    this.logger.error({ event: 'risk_worker_error', error: errorMessage(err) });
  }

  /** Claims the assessment for this attempt. Returns null if there is nothing (left) to do. */
  private markProcessing(assessmentId: string): Promise<LockedPair | null> {
    return this.dataSource.transaction(async (manager) => {
      const pair = await this.lockPair(manager, assessmentId);
      if (!pair || isTerminal(pair.assessment)) return null;

      const { application, assessment } = pair;
      assessment.status = RiskAssessmentStatus.PROCESSING;
      assessment.attempts += 1;
      await manager.save(assessment);

      if (isCurrentSubmission(application, assessment)) {
        application.riskStatus = ApplicationRiskStatus.PROCESSING;
        await manager.save(application);
      }
      return pair;
    });
  }

  private complete(assessmentId: string, result: RiskCheckResult): Promise<Outcome> {
    return this.dataSource.transaction(async (manager) => {
      const pair = await this.lockPair(manager, assessmentId);
      // Re-checked under lock: a concurrent duplicate may have finished first.
      if (!pair || isTerminal(pair.assessment)) return 'skipped';

      const { application, assessment } = pair;
      const status = result.outcome === 'FLAGGED' ? RiskAssessmentStatus.FLAGGED : RiskAssessmentStatus.CLEAR;
      Object.assign(assessment, {
        status,
        score: result.score,
        riskLevel: result.riskLevel,
        reasons: result.reasons,
        providerReference: result.providerReference,
        lastError: null,
        completedAt: new Date(),
      });
      await manager.save(assessment);

      // A result for an older submission is kept as history but must not move the application.
      const movesApplication = isCurrentSubmission(application, assessment);
      if (movesApplication) {
        application.status = transition(application.status, ApplicationAction.COMPLETE_RISK_REVIEW);
        application.riskStatus = status === RiskAssessmentStatus.FLAGGED ? ApplicationRiskStatus.FLAGGED : ApplicationRiskStatus.CLEAR;
        await manager.save(application);
      }

      await this.audit.record(manager, {
        actorId: null,
        action: AuditAction.RISK_ASSESSMENT_COMPLETED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        metadata: {
          riskAssessmentId: assessment.id,
          submissionNumber: assessment.submissionNumber,
          result: status,
          score: result.score,
          riskLevel: result.riskLevel,
          reasons: result.reasons,
          applicationStatus: application.status,
          appliedToApplication: movesApplication,
        },
      });
      return 'completed';
    });
  }

  private async recordFailure(assessmentId: string, err: unknown, isFinalAttempt: boolean): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const pair = await this.lockPair(manager, assessmentId);
      if (!pair || isTerminal(pair.assessment)) return;

      const { application, assessment } = pair;
      assessment.lastError = errorMessage(err).slice(0, 500);
      // Between attempts the assessment waits for its retry; after the last one it is FAILED.
      assessment.status = isFinalAttempt ? RiskAssessmentStatus.FAILED : RiskAssessmentStatus.PENDING;
      if (isFinalAttempt) assessment.completedAt = new Date();
      await manager.save(assessment);

      if (isCurrentSubmission(application, assessment)) {
        application.riskStatus = isFinalAttempt ? ApplicationRiskStatus.FAILED : ApplicationRiskStatus.PENDING;
        await manager.save(application);
      }

      if (isFinalAttempt) {
        await this.audit.record(manager, {
          actorId: null,
          action: AuditAction.RISK_ASSESSMENT_FAILED,
          entityType: AuditEntityType.MERCHANT_APPLICATION,
          entityId: application.id,
          metadata: {
            riskAssessmentId: assessment.id,
            submissionNumber: assessment.submissionNumber,
            attempts: assessment.attempts,
            error: assessment.lastError,
          },
        });
      }
    });
  }

  /** Locks the application row, then the assessment row (fixed order everywhere). */
  private async lockPair(manager: EntityManager, assessmentId: string): Promise<LockedPair | null> {
    const ref = await manager.getRepository(RiskAssessment).findOne({ where: { id: assessmentId }, select: { id: true, applicationId: true } });
    if (!ref) return null;

    const application = await manager
      .getRepository(MerchantApplication)
      .createQueryBuilder('app')
      .setLock('pessimistic_write')
      .where('app.id = :id', { id: ref.applicationId })
      .getOne();
    const assessment = await manager
      .getRepository(RiskAssessment)
      .createQueryBuilder('ra')
      .setLock('pessimistic_write')
      .where('ra.id = :id', { id: assessmentId })
      .getOne();
    return application && assessment ? { application, assessment } : null;
  }
}

function isTerminal(assessment: RiskAssessment): boolean {
  return TERMINAL_RISK_STATUSES.includes(assessment.status);
}

function isCurrentSubmission(application: MerchantApplication, assessment: RiskAssessment): boolean {
  return application.status === ApplicationStatus.SUBMITTED && application.submissionCount === assessment.submissionNumber;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : 'Unknown error';
}
