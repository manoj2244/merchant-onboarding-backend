import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditAction, AuditEntityType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { RiskAssessmentResponseDto } from '../risk/dto/risk-assessment-response.dto';
import { RiskAssessment } from '../risk/entities/risk-assessment.entity';
import { AssessmentRef, RiskReviewProducer } from '../risk/risk-review.producer';
import { RiskAssessmentStatus } from '../risk/risk.enums';
import { ApplicationRiskStatus, ApplicationStatus } from './application.enums';
import { ApplicationsService } from './applications.service';
import { ApplicationAction, transition } from './domain/application-state-machine';
import { ApplicationResponseDto } from './dto/application-response.dto';
import { ApplicationAccessPolicy } from './policies/application-access.policy';

/** State-changing workflow operations on an application (submit, risk retry; review in step 6). */
@Injectable()
export class ApplicationWorkflowService {
  private readonly logger = new Logger(ApplicationWorkflowService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationsService,
    private readonly policy: ApplicationAccessPolicy,
    private readonly audit: AuditService,
    private readonly riskQueue: RiskReviewProducer,
  ) {}

  /**
   * DRAFT/NEEDS_INFORMATION → SUBMITTED and start an asynchronous risk check.
   * The row lock makes concurrent submits serial: the second one sees SUBMITTED and gets 409,
   * and UNIQUE(application_id, submission_number) backs that up at the database level.
   */
  async submit(user: AuthenticatedUser, id: string): Promise<ApplicationResponseDto> {
    const { application, assessment } = await this.dataSource.transaction(async (manager) => {
      const application = await this.applications.loadVisible(user, id, { manager, lock: true });
      this.policy.assertCanModify(user, application);

      const fromStatus = application.status;
      application.status = transition(application.status, ApplicationAction.SUBMIT);
      application.submissionCount += 1;
      application.riskStatus = ApplicationRiskStatus.PENDING;
      await manager.save(application);

      const assessment = await manager.getRepository(RiskAssessment).save(
        manager.getRepository(RiskAssessment).create({
          applicationId: application.id,
          submissionNumber: application.submissionCount,
          status: RiskAssessmentStatus.PENDING,
        }),
      );

      await this.audit.record(manager, {
        actorId: user.id,
        action: AuditAction.APPLICATION_SUBMITTED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        metadata: { fromStatus, toStatus: application.status, submissionNumber: application.submissionCount, riskAssessmentId: assessment.id },
      });
      return { application, assessment };
    });

    // After commit, never inside the transaction: the worker must not see a job before its row exists.
    await this.enqueueAfterCommit(assessment);
    return ApplicationResponseDto.from(application);
  }

  async listRiskAssessments(user: AuthenticatedUser, id: string): Promise<RiskAssessmentResponseDto[]> {
    await this.applications.loadVisible(user, id);
    const rows = await this.dataSource.getRepository(RiskAssessment).find({
      where: { applicationId: id },
      order: { submissionNumber: 'DESC' },
    });
    return rows.map((row) => RiskAssessmentResponseDto.from(row));
  }

  /**
   * ADMIN recovery for the current submission's risk check when it FAILED after all retries, or is
   * stuck PENDING because enqueueing failed after commit (e.g. Redis was briefly unavailable).
   */
  async retryRiskAssessment(user: AuthenticatedUser, id: string): Promise<RiskAssessmentResponseDto> {
    const assessment = await this.dataSource.transaction(async (manager) => {
      const application = await this.applications.loadVisible(user, id, { manager, lock: true });
      if (application.status !== ApplicationStatus.SUBMITTED) {
        throw new ConflictException(`Risk review can only be retried while the application is SUBMITTED (is ${application.status})`);
      }

      const assessment = await manager
        .getRepository(RiskAssessment)
        .createQueryBuilder('ra')
        .setLock('pessimistic_write')
        .where('ra.applicationId = :id AND ra.submissionNumber = :n', { id, n: application.submissionCount })
        .getOne();
      if (!assessment || ![RiskAssessmentStatus.FAILED, RiskAssessmentStatus.PENDING].includes(assessment.status)) {
        throw new ConflictException('Only a FAILED or PENDING risk assessment can be retried');
      }

      const previousStatus = assessment.status;
      assessment.status = RiskAssessmentStatus.PENDING;
      assessment.completedAt = null;
      await manager.save(assessment);
      application.riskStatus = ApplicationRiskStatus.PENDING;
      await manager.save(application);

      await this.audit.record(manager, {
        actorId: user.id,
        action: AuditAction.RISK_ASSESSMENT_RETRIED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        metadata: { riskAssessmentId: assessment.id, submissionNumber: assessment.submissionNumber, previousStatus },
      });
      return assessment;
    });

    await this.riskQueue.enqueue(assessment, { replaceFinishedJob: true });
    return RiskAssessmentResponseDto.from(assessment);
  }

  /**
   * If Redis is down at this moment the submission itself has still succeeded (it is committed);
   * the assessment stays PENDING and an admin can re-enqueue it via the retry endpoint.
   * A transactional outbox would remove this gap entirely (see README trade-offs).
   */
  private async enqueueAfterCommit(ref: AssessmentRef): Promise<void> {
    try {
      await this.riskQueue.enqueue(ref);
    } catch (err) {
      this.logger.error({
        event: 'risk_job_enqueue_failed',
        assessmentId: ref.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
