import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApplicationRiskStatus, ApplicationStatus } from '../src/applications/application.enums';
import { AuditAction } from '../src/audit/audit.constants';
import { RISK_REVIEW_QUEUE } from '../src/risk/risk.constants';
import { bearer, createApplication, createStandardActors, resetDatabase, StandardActors } from './utils/fixtures';
import { waitFor, waitForQueueIdle } from './utils/scripted-risk-provider';
import { createTestApp } from './utils/test-app';

/**
 * End-to-end workflows through the public API only (no direct DB manipulation), with the real
 * worker and the deterministic simulated KYB provider.
 */
describe('Application lifecycle (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let queue: Queue;
  let actors: StandardActors;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    queue = app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await resetDatabase(dataSource);
    actors = await createStandardActors(app, dataSource);
  });

  afterEach(async () => {
    await waitForQueueIdle(queue);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const get = (id: string, token = actors.admin.token) => http().get(`/applications/${id}`).set(bearer(token)).expect(200);
  const submit = (id: string) => http().post(`/applications/${id}/submit`).set(bearer(actors.salesA.token));
  const assign = (id: string, reviewerId = actors.reviewerA.user.id) =>
    http().post(`/applications/${id}/assign-reviewer`).set(bearer(actors.admin.token)).send({ reviewerId });
  const decide = (id: string, decision: string, comment?: string, token = actors.reviewerA.token) =>
    http().post(`/applications/${id}/decisions`).set(bearer(token)).send({ decision, comment });
  const waitUntilUnderReview = (id: string) =>
    waitFor(
      async () => (await get(id)).body,
      (body) => body.status === ApplicationStatus.UNDER_REVIEW,
    );
  const auditActions = async (id: string) =>
    (await http().get(`/applications/${id}/audit-logs`).set(bearer(actors.admin.token)).expect(200)).body.map(
      (e: { action: string }) => e.action,
    );

  /** create → submit → risk check → assign; returns the id of an application ready for a decision. */
  async function readyForDecision(overrides: Record<string, unknown> = {}): Promise<string> {
    const { id } = await createApplication(app, actors.salesA.token, overrides);
    await submit(id).expect(202);
    await assign(id).expect(200);
    await waitUntilUnderReview(id);
    return id;
  }

  it('happy path: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED, fully audited', async () => {
    const { id } = await createApplication(app, actors.salesA.token);
    expect((await get(id)).body.status).toBe(ApplicationStatus.DRAFT);

    await submit(id).expect(202);
    const reviewed = await waitUntilUnderReview(id);
    expect(reviewed.riskStatus).toBe(ApplicationRiskStatus.CLEAR);

    await assign(id).expect(200);
    const decision = await decide(id, 'APPROVE').expect(201);
    expect(decision.body).toMatchObject({ decision: 'APPROVE', comment: null, applicationStatus: ApplicationStatus.APPROVED });

    expect((await get(id, actors.salesA.token)).body.status).toBe(ApplicationStatus.APPROVED);
    expect(await auditActions(id)).toEqual([
      AuditAction.APPLICATION_CREATED,
      AuditAction.APPLICATION_SUBMITTED,
      AuditAction.RISK_ASSESSMENT_COMPLETED,
      AuditAction.REVIEWER_ASSIGNED,
      AuditAction.APPLICATION_APPROVED,
    ]);
  });

  it('a FLAGGED application can still be rejected (or approved) only by the reviewer', async () => {
    const id = await readyForDecision({ mcc: '7995' });
    expect((await get(id)).body.riskStatus).toBe(ApplicationRiskStatus.FLAGGED);

    const res = await decide(id, 'REJECT', 'Gambling MCC outside risk appetite').expect(201);
    expect(res.body.applicationStatus).toBe(ApplicationStatus.REJECTED);
  });

  it('request-info loop: NEEDS_INFORMATION → edit → resubmit → new risk check → approve', async () => {
    const id = await readyForDecision();

    await decide(id, 'REQUEST_INFO', 'Please add the business website').expect(201);
    expect((await get(id)).body.status).toBe(ApplicationStatus.NEEDS_INFORMATION);

    await http().patch(`/applications/${id}`).set(bearer(actors.salesA.token)).send({ website: 'https://bakery.example.com' }).expect(200);
    const resubmitted = await submit(id).expect(202);
    expect(resubmitted.body.submissionCount).toBe(2);

    await waitUntilUnderReview(id);
    // Assignment survives the loop: the same reviewer finishes the review.
    await decide(id, 'APPROVE').expect(201);

    const history = await http().get(`/applications/${id}/decisions`).set(bearer(actors.salesA.token)).expect(200);
    expect(history.body.map((d: { decision: string }) => d.decision)).toEqual(['REQUEST_INFO', 'APPROVE']);
    const assessments = await http().get(`/applications/${id}/risk-assessments`).set(bearer(actors.admin.token)).expect(200);
    expect(assessments.body).toHaveLength(2);
  });

  describe('invalid transitions are rejected with 409', () => {
    it('cannot decide while the risk check has not finished (still SUBMITTED)', async () => {
      const { id } = await createApplication(app, actors.salesA.token, { businessName: 'Slow [simulate-provider-outage]' });
      await submit(id).expect(202);
      await assign(id).expect(200);

      const res = await decide(id, 'APPROVE').expect(409);
      expect(res.body.message).toBe('Cannot approve an application in status SUBMITTED');
    });

    it('cannot decide twice: APPROVED is terminal', async () => {
      const id = await readyForDecision();
      await decide(id, 'APPROVE').expect(201);
      await decide(id, 'REJECT', 'Changed my mind').expect(409);
      await decide(id, 'REQUEST_INFO', 'More please').expect(409);
    });

    it('cannot edit or resubmit a REJECTED application', async () => {
      const id = await readyForDecision();
      await decide(id, 'REJECT', 'Not eligible').expect(201);
      await http().patch(`/applications/${id}`).set(bearer(actors.salesA.token)).send({ businessName: 'Retry' }).expect(409);
      await submit(id).expect(409);
    });

    it('cannot assign a reviewer to a DRAFT application', async () => {
      const { id } = await createApplication(app, actors.salesA.token);
      await assign(id).expect(409);
    });

    it('cannot assign after a final decision', async () => {
      const id = await readyForDecision();
      await decide(id, 'APPROVE').expect(201);
      await assign(id, actors.reviewerB.user.id).expect(409);
    });
  });

  describe('assignment validation', () => {
    it.each([
      ['a SALES user', () => actors.salesA.user.id],
      ['an ADMIN', () => actors.admin.user.id],
      ['an unknown user', () => '00000000-0000-4000-8000-000000000000'],
    ])('rejects assigning %s as reviewer with 400', async (_label, reviewerId) => {
      const { id } = await createApplication(app, actors.salesA.token);
      await submit(id).expect(202);
      const res = await assign(id, reviewerId()).expect(400);
      expect(res.body.message).toBe('reviewerId must reference an active REVIEWER');
    });

    it('re-assigning the same reviewer is a no-op (no duplicate audit entry)', async () => {
      const { id } = await createApplication(app, actors.salesA.token);
      await submit(id).expect(202);
      await assign(id).expect(200);
      await assign(id).expect(200);
      expect((await auditActions(id)).filter((a: string) => a === AuditAction.REVIEWER_ASSIGNED)).toHaveLength(1);
    });
  });

  describe('decision validation', () => {
    it.each(['REJECT', 'REQUEST_INFO'])('%s requires a comment', async (decision) => {
      const id = await readyForDecision();
      await decide(id, decision).expect(400);
      await decide(id, decision, '   ').expect(400);
      expect((await get(id)).body.status).toBe(ApplicationStatus.UNDER_REVIEW);
    });

    it('rejects an unknown decision type', async () => {
      const id = await readyForDecision();
      await decide(id, 'ESCALATE').expect(400);
    });
  });
});
