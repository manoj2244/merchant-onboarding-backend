import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApplicationRiskStatus, ApplicationStatus } from '../src/applications/application.enums';
import { MerchantApplication } from '../src/applications/entities/merchant-application.entity';
import { AuditAction } from '../src/audit/audit.constants';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { RiskAssessment } from '../src/risk/entities/risk-assessment.entity';
import { RISK_PROVIDER } from '../src/risk/providers/risk-provider.interface';
import { riskJobId, RiskReviewProducer } from '../src/risk/risk-review.producer';
import { RISK_ASSESS_JOB, RISK_REVIEW_QUEUE } from '../src/risk/risk.constants';
import { RiskAssessmentStatus, RiskLevel } from '../src/risk/risk.enums';
import {
  bearer,
  createApplication,
  createStandardActors,
  forceApplicationState,
  resetDatabase,
  StandardActors,
} from './utils/fixtures';
import { ScriptedRiskProvider, waitFor, waitForQueueIdle } from './utils/scripted-risk-provider';
import { createTestApp } from './utils/test-app';

/** Runs the real BullMQ worker against Redis, with a scriptable provider in place of the vendor. */
describe('Asynchronous risk review (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let queue: Queue;
  let actors: StandardActors;
  const provider = new ScriptedRiskProvider();

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp((b) => b.overrideProvider(RISK_PROVIDER).useValue(provider)));
    queue = app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await resetDatabase(dataSource);
    provider.reset();
    actors = await createStandardActors(app, dataSource);
  });

  // Let in-flight jobs finish before the next test wipes the queue and database underneath them.
  afterEach(async () => {
    provider.reset();
    await waitForQueueIdle(queue);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const applicationRow = (id: string) => dataSource.getRepository(MerchantApplication).findOneByOrFail({ id });
  const assessmentsOf = (applicationId: string) =>
    dataSource.getRepository(RiskAssessment).find({ where: { applicationId }, order: { submissionNumber: 'ASC' } });
  const auditActions = async (entityId: string) =>
    (await dataSource.getRepository(AuditLog).find({ where: { entityId }, order: { createdAt: 'ASC' } })).map((e) => e.action);

  const submit = (id: string, token = actors.salesA.token) => http().post(`/applications/${id}/submit`).set(bearer(token));

  const waitForAssessment = (applicationId: string, statuses: RiskAssessmentStatus[], submissionNumber = 1) =>
    waitFor(
      async () => (await assessmentsOf(applicationId)).find((a) => a.submissionNumber === submissionNumber),
      (a) => !!a && statuses.includes(a.status),
    ) as Promise<RiskAssessment>;

  describe('submission', () => {
    it('responds 202 without waiting for the provider and enqueues one deterministic job', async () => {
      provider.respondAfter(500);
      const created = await createApplication(app, actors.salesA.token);

      const res = await submit(created.id).expect(202);
      expect(res.body).toMatchObject({
        status: ApplicationStatus.SUBMITTED,
        riskStatus: ApplicationRiskStatus.PENDING,
        submissionCount: 1,
      });

      const [assessment] = await assessmentsOf(created.id);
      expect(assessment).toMatchObject({ submissionNumber: 1 });
      expect([RiskAssessmentStatus.PENDING, RiskAssessmentStatus.PROCESSING]).toContain(assessment.status);

      const job = await queue.getJob(riskJobId({ applicationId: created.id, submissionNumber: 1 }));
      expect(job?.data).toEqual({ assessmentId: assessment.id });
      expect(job?.opts).toMatchObject({ attempts: 3, backoff: { type: 'exponential', delay: 50 } });

      expect(await auditActions(created.id)).toEqual([AuditAction.APPLICATION_CREATED, AuditAction.APPLICATION_SUBMITTED]);
    });

    it('rejects a second submit of the same submission with 409 and creates no second assessment', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      await submit(created.id).expect(409);
      expect(await assessmentsOf(created.id)).toHaveLength(1);
    });

    it('serialises concurrent submits: exactly one wins', async () => {
      const created = await createApplication(app, actors.salesA.token);
      const results = await Promise.all([submit(created.id), submit(created.id), submit(created.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([202, 409, 409]);
      expect(await assessmentsOf(created.id)).toHaveLength(1);
    });

    it("SALES cannot submit another SALES user's application", async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id, actors.salesB.token).expect(404);
      expect((await applicationRow(created.id)).status).toBe(ApplicationStatus.DRAFT);
    });

    it('REVIEWER cannot submit', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id, actors.reviewerA.token).expect(403);
    });
  });

  describe('worker', () => {
    it('persists a CLEAR result and moves the application to UNDER_REVIEW — never to APPROVED', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);

      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);
      expect(assessment).toMatchObject({
        score: 10,
        riskLevel: RiskLevel.LOW,
        reasons: [],
        attempts: 1,
        lastError: null,
        providerReference: expect.stringMatching(/^sim-/),
        completedAt: expect.any(Date),
      });

      const application = await applicationRow(created.id);
      expect(application.status).toBe(ApplicationStatus.UNDER_REVIEW);
      expect(application.riskStatus).toBe(ApplicationRiskStatus.CLEAR);

      const completed = await dataSource.getRepository(AuditLog).findOneByOrFail({
        entityId: created.id,
        action: AuditAction.RISK_ASSESSMENT_COMPLETED,
      });
      expect(completed.actorId).toBeNull(); // system action
    });

    it('a FLAGGED result still leaves the decision to a human reviewer', async () => {
      const created = await createApplication(app, actors.salesA.token, { mcc: '7995' });
      await submit(created.id).expect(202);

      await waitForAssessment(created.id, [RiskAssessmentStatus.FLAGGED]);
      const application = await applicationRow(created.id);
      expect(application.status).toBe(ApplicationStatus.UNDER_REVIEW);
      expect(application.riskStatus).toBe(ApplicationRiskStatus.FLAGGED);
    });

    it('retries transient provider failures with backoff and then succeeds', async () => {
      provider.failNext(2);
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);

      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);
      expect(provider.calls).toBe(3);
      expect(assessment.attempts).toBe(3);
      expect(assessment.lastError).toBeNull();
      expect((await applicationRow(created.id)).status).toBe(ApplicationStatus.UNDER_REVIEW);
    });

    it('marks the assessment FAILED after the last attempt, keeps the application SUBMITTED, and audits it', async () => {
      provider.failAlways();
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);

      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.FAILED]);
      expect(assessment.attempts).toBe(3);
      expect(assessment.lastError).toContain('Scripted outage');
      expect(provider.calls).toBe(3);

      const application = await applicationRow(created.id);
      expect(application.status).toBe(ApplicationStatus.SUBMITTED);
      expect(application.riskStatus).toBe(ApplicationRiskStatus.FAILED);
      expect((await auditActions(created.id)).filter((a) => a === AuditAction.RISK_ASSESSMENT_FAILED)).toHaveLength(1);
    });
  });

  describe('permanent failures', () => {
    it('does not retry an unrecoverable provider error and marks the check FAILED', async () => {
      provider.failPermanently();
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);

      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.FAILED]);
      expect(provider.calls).toBe(1);
      expect(assessment.lastError).toContain('Scripted permanent rejection');
      expect((await applicationRow(created.id)).riskStatus).toBe(ApplicationRiskStatus.FAILED);
    });

    it('a failure after the provider call (e.g. DB error saving the result) still ends FAILED, never stuck in PROCESSING', async () => {
      provider.returnCorruptResult();
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);

      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.FAILED]);
      expect(provider.calls).toBe(3); // retried, then failed for good via the worker 'failed' handler
      expect(assessment.lastError).toBeTruthy();
      const application = await applicationRow(created.id);
      expect(application.status).toBe(ApplicationStatus.SUBMITTED);
      expect(application.riskStatus).toBe(ApplicationRiskStatus.FAILED);
      expect((await auditActions(created.id)).filter((a) => a === AuditAction.RISK_ASSESSMENT_FAILED)).toHaveLength(1);
    });

    it('sends the provider a stable idempotency key across retries (the assessment id)', async () => {
      provider.failNext(2);
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);
      expect(provider.idempotencyKeys).toEqual([assessment.id, assessment.id, assessment.id]);
    });
  });

  describe('idempotency', () => {
    it('a duplicate job for a finished assessment is skipped and never reaches the provider', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      const assessment = await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);
      expect(provider.calls).toBe(1);

      // Simulate an at-least-once redelivery under a different job id.
      const duplicate = await queue.add(RISK_ASSESS_JOB, { assessmentId: assessment.id }, { jobId: `duplicate-${assessment.id}` });
      const finished = await waitFor(
        () => queue.getJob(duplicate.id as string),
        (job) => !!job && job.finishedOn !== undefined,
      );

      expect(finished?.returnvalue).toBe('skipped');
      expect(provider.calls).toBe(1);
      expect(await assessmentsOf(created.id)).toHaveLength(1);
      expect((await auditActions(created.id)).filter((a) => a === AuditAction.RISK_ASSESSMENT_COMPLETED)).toHaveLength(1);
    });

    it('enqueueing the same submission twice yields a single job (deterministic job id)', async () => {
      provider.respondAfter(300);
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      const [assessment] = await assessmentsOf(created.id);

      await app.get(RiskReviewProducer).enqueue(assessment);
      await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);

      expect(provider.calls).toBe(1);
      const counts = await queue.getJobCounts('completed', 'failed', 'waiting', 'active', 'delayed');
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
    });

    it('the database rejects a second assessment for the same submission', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      await expect(
        dataSource.getRepository(RiskAssessment).insert({ applicationId: created.id, submissionNumber: 1 }),
      ).rejects.toThrow(/uq_risk_assessments_application_submission/);
    });

    it('a resubmission after NEEDS_INFORMATION gets its own, new assessment', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await submit(created.id).expect(202);
      await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR]);

      await forceApplicationState(dataSource, created.id, { status: ApplicationStatus.NEEDS_INFORMATION });
      const res = await submit(created.id).expect(202);
      expect(res.body.submissionCount).toBe(2);
      await waitForAssessment(created.id, [RiskAssessmentStatus.CLEAR], 2);

      const history = await http().get(`/applications/${created.id}/risk-assessments`).set(bearer(actors.salesA.token)).expect(200);
      expect(history.body.map((a: { submissionNumber: number }) => a.submissionNumber)).toEqual([2, 1]);
      expect(provider.calls).toBe(2);
    });
  });

  describe('admin retry of a failed check', () => {
    let applicationId: string;

    beforeEach(async () => {
      provider.failAlways();
      applicationId = (await createApplication(app, actors.salesA.token)).id;
      await submit(applicationId).expect(202);
      await waitForAssessment(applicationId, [RiskAssessmentStatus.FAILED]);
      provider.reset(); // provider is healthy again
    });

    it('ADMIN can re-run the failed check, which then completes normally', async () => {
      await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(202);

      await waitForAssessment(applicationId, [RiskAssessmentStatus.CLEAR]);
      const application = await applicationRow(applicationId);
      expect(application.status).toBe(ApplicationStatus.UNDER_REVIEW);
      expect(await assessmentsOf(applicationId)).toHaveLength(1); // same assessment, re-run
      expect(await auditActions(applicationId)).toEqual([
        AuditAction.APPLICATION_CREATED,
        AuditAction.APPLICATION_SUBMITTED,
        AuditAction.RISK_ASSESSMENT_FAILED,
        AuditAction.RISK_ASSESSMENT_RETRIED,
        AuditAction.RISK_ASSESSMENT_COMPLETED,
      ]);
    });

    it('SALES cannot trigger a retry', async () => {
      await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.salesA.token)).expect(403);
    });

    it.each([RiskAssessmentStatus.PENDING, RiskAssessmentStatus.PROCESSING])(
      'recovers a check stuck in %s with no job in flight (lost enqueue / crashed worker)',
      async (stuckStatus) => {
        await queue.obliterate({ force: true }); // no job exists for it any more
        await dataSource.getRepository(RiskAssessment).update({ applicationId }, { status: stuckStatus, completedAt: null });

        await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(202);
        await waitForAssessment(applicationId, [RiskAssessmentStatus.CLEAR]);
        expect((await applicationRow(applicationId)).status).toBe(ApplicationStatus.UNDER_REVIEW);
      },
    );

    it('refuses to retry while the check is genuinely in progress', async () => {
      provider.respondAfter(1_500);
      await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(202);
      const res = await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(409);
      expect(res.body.message).toBe('The risk check is still in progress');
      await waitForAssessment(applicationId, [RiskAssessmentStatus.CLEAR]);
      expect(provider.calls).toBe(1);
    });

    it('returns 409 when there is nothing to retry', async () => {
      await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(202);
      await waitForAssessment(applicationId, [RiskAssessmentStatus.CLEAR]);
      await http().post(`/applications/${applicationId}/risk-assessments/retry`).set(bearer(actors.admin.token)).expect(409);
    });
  });

  it("risk assessments of another SALES user's application are not visible", async () => {
    const created = await createApplication(app, actors.salesA.token);
    await http().get(`/applications/${created.id}/risk-assessments`).set(bearer(actors.salesB.token)).expect(404);
  });
});
