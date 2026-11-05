import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { AuditAction, AuditEntityType } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { RiskAssessmentResponseDto } from '../risk/dto/risk-assessment-response.dto';
import { RiskAssessment } from '../risk/entities/risk-assessment.entity';
import { AssessmentRef, RiskReviewProducer } from '../risk/risk-review.producer';
import { RiskAssessmentStatus } from '../risk/risk.enums';
import { UsersService } from '../users/users.service';
import { ApplicationRiskStatus, ApplicationStatus, DecisionType } from './application.enums';
import { ApplicationsService } from './applications.service';
import { ApplicationAction, transition } from './domain/application-state-machine';
import { ApplicationResponseDto } from './dto/application-response.dto';
import { CreateDecisionDto, DecisionResponseDto, DecisionResultDto } from './dto/decision.dto';
import { ReviewDecision } from './entities/review-decision.entity';
import { ApplicationAccessPolicy } from './policies/application-access.policy';

const DECISION_RULES: Record<DecisionType, { action: ApplicationAction; audit: AuditAction }> = {
  [DecisionType.APPROVE]: { action: ApplicationAction.APPROVE, audit: AuditAction.APPLICATION_APPROVED },
  [DecisionType.REJECT]: { action: ApplicationAction.REJECT, audit: AuditAction.APPLICATION_REJECTED },
  [DecisionType.REQUEST_INFO]: { action: ApplicationAction.REQUEST_INFO, audit: AuditAction.INFORMATION_REQUESTED },
};

/**
 * State-changing workflow operations: submit, risk retry, reviewer assignment and decisions.
 * Each one is a single transaction holding a row lock on the application, so the state check,
 * the change and its audit entry cannot interleave with another request.
 */
@Injectable()
export class ApplicationWorkflowService {
  private readonly logger = new Logger(ApplicationWorkflowService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationsService,
    private readonly users: UsersService,
    private readonly policy: ApplicationAccessPolicy,
    private readonly audit: AuditService,
    private readonly riskQueue: RiskReviewProducer,
  ) {}

  async assignReviewer(user: AuthenticatedUser, id: string, reviewerId: string): Promise<ApplicationResponseDto> {
    this.policy.assertCanAssign(user);
    const reviewer = await this.users.findActiveReviewer(reviewerId);
    if (!reviewer) throw new BadRequestException('reviewerId must reference an active REVIEWER');

    const application = await this.dataSource.transaction(async (manager) => {
      const application = await this.applications.loadVisible(user, id, { manager, lock: true });
      transition(application.status, ApplicationAction.ASSIGN_REVIEWER);
      if (application.assignedReviewerId === reviewer.id) return application; // idempotent

      const previousReviewerId = application.assignedReviewerId;
      application.assignedReviewerId = reviewer.id;
      await manager.save(application);

      await this.audit.record(manager, {
        actorId: user.id,
        action: AuditAction.REVIEWER_ASSIGNED,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        metadata: { reviewerId: reviewer.id, previousReviewerId, status: application.status },
      });
      return application;
    });
    return ApplicationResponseDto.from(application);
  }

  /**
   * Only the assigned reviewer, only while UNDER_REVIEW (i.e. after the risk check finished).
   * An unassigned reviewer never even loads the row (visibility scope → 404).
   */
  async decide(user: AuthenticatedUser, id: string, dto: CreateDecisionDto): Promise<DecisionResultDto> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.applications.loadVisible(user, id, { manager, lock: true });
      this.policy.assertCanDecide(user, application);

      const rule = DECISION_RULES[dto.decision];
      const fromStatus = application.status;
      application.status = transition(application.status, rule.action);
      await manager.save(application);

      const decisions = manager.getRepository(ReviewDecision);
      const decision = await decisions.save(
        decisions.create({
          applicationId: application.id,
          reviewerId: user.id,
          decision: dto.decision,
          comment: dto.comment ?? null,
        }),
      );

      await this.audit.record(manager, {
        actorId: user.id,
        action: rule.audit,
        entityType: AuditEntityType.MERCHANT_APPLICATION,
        entityId: application.id,
        // The free-text comment stays in review_decisions; the audit references it by id.
        metadata: { decisionId: decision.id, fromStatus, toStatus: application.status, riskStatus: application.riskStatus },
      });

      return { ...DecisionResponseDto.from(decision), applicationStatus: application.status };
    });
  }

  async listDecisions(user: AuthenticatedUser, id: string): Promise<DecisionResponseDto[]> {
    await this.applications.loadVisible(user, id);
    const rows = await this.dataSource.getRepository(ReviewDecision).find({
      where: { applicationId: id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => DecisionResponseDto.from(row));
  }

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
