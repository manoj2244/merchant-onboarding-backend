import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApplicationRiskStatus, ApplicationStatus } from '../src/applications/application.enums';
import { MerchantApplication } from '../src/applications/entities/merchant-application.entity';
import {
  applicationPayload,
  bearer,
  createApplication,
  createStandardActors,
  forceApplicationState,
  resetDatabase,
  StandardActors,
} from './utils/fixtures';
import { createTestApp } from './utils/test-app';

/**
 * Object-level authorization: every attempt to reach another user's application by id must fail,
 * and must fail the same way as a non-existent id (404), so ids cannot be probed.
 */
describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let actors: StandardActors;
  let appOfSalesA: { id: string };

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    actors = await createStandardActors(app, dataSource);
    appOfSalesA = await createApplication(app, actors.salesA.token, { businessName: 'Sales A Merchant' });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const NON_EXISTENT_ID = '00000000-0000-4000-8000-000000000000';

  describe('unauthenticated access', () => {
    it.each([
      ['post', '/applications'],
      ['get', '/applications'],
      ['get', `/applications/${NON_EXISTENT_ID}`],
      ['patch', `/applications/${NON_EXISTENT_ID}`],
      ['get', `/applications/${NON_EXISTENT_ID}/audit-logs`],
    ] as const)('%s %s requires a token', async (method, path) => {
      await http()[method](path).expect(401);
    });
  });

  describe('SALES isolation', () => {
    it('SALES can read their own application', async () => {
      await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.salesA.token)).expect(200);
    });

    it("SALES cannot read another SALES user's application by id (404, same as non-existent)", async () => {
      const foreign = await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.salesB.token)).expect(404);
      const missing = await http().get(`/applications/${NON_EXISTENT_ID}`).set(bearer(actors.salesB.token)).expect(404);
      expect(foreign.body.message).toBe(missing.body.message);
    });

    it("SALES cannot update another SALES user's application, and nothing changes", async () => {
      await http()
        .patch(`/applications/${appOfSalesA.id}`)
        .set(bearer(actors.salesB.token))
        .send({ businessName: 'Hijacked' })
        .expect(404);

      const stored = await dataSource.getRepository(MerchantApplication).findOneByOrFail({ id: appOfSalesA.id });
      expect(stored.businessName).toBe('Sales A Merchant');
    });

    it("SALES cannot read another SALES user's audit trail", async () => {
      await http().get(`/applications/${appOfSalesA.id}/audit-logs`).set(bearer(actors.salesB.token)).expect(404);
    });

    it("SALES cannot read another SALES user's decisions or risk assessments", async () => {
      await http().get(`/applications/${appOfSalesA.id}/decisions`).set(bearer(actors.salesB.token)).expect(404);
      await http().get(`/applications/${appOfSalesA.id}/risk-assessments`).set(bearer(actors.salesB.token)).expect(404);
    });

    it("SALES cannot submit another SALES user's application", async () => {
      await http().post(`/applications/${appOfSalesA.id}/submit`).set(bearer(actors.salesB.token)).expect(404);
      const stored = await dataSource.getRepository(MerchantApplication).findOneByOrFail({ id: appOfSalesA.id });
      expect(stored.status).toBe(ApplicationStatus.DRAFT);
    });

    it("SALES list never includes another SALES user's applications", async () => {
      await createApplication(app, actors.salesB.token, { businessName: 'Sales B Merchant' });

      const res = await http().get('/applications').set(bearer(actors.salesB.token)).expect(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data.map((a: { businessName: string }) => a.businessName)).toEqual(['Sales B Merchant']);
    });

    it('SALES cannot set ownership, status, risk status or reviewer through the body', async () => {
      for (const field of [
        { createdById: actors.salesB.user.id },
        { status: ApplicationStatus.APPROVED },
        { riskStatus: 'CLEAR' },
        { assignedReviewerId: actors.reviewerA.user.id },
      ]) {
        await http().patch(`/applications/${appOfSalesA.id}`).set(bearer(actors.salesA.token)).send(field).expect(400);
        // A complete, otherwise valid payload: the only reason to reject is the forbidden field.
        const res = await http()
          .post('/applications')
          .set(bearer(actors.salesA.token))
          .send(applicationPayload(field))
          .expect(400);
        expect(res.body.message).toEqual([`property ${Object.keys(field)[0]} should not exist`]);
      }
      const stored = await dataSource.getRepository(MerchantApplication).findOneByOrFail({ id: appOfSalesA.id });
      expect(stored).toMatchObject({ createdById: actors.salesA.user.id, status: ApplicationStatus.DRAFT, assignedReviewerId: null });
    });
  });

  describe('REVIEWER scope', () => {
    beforeEach(async () => {
      await forceApplicationState(dataSource, appOfSalesA.id, {
        status: ApplicationStatus.UNDER_REVIEW,
        assignedReviewerId: actors.reviewerA.user.id,
      });
    });

    it('REVIEWER cannot create applications', async () => {
      await http().post('/applications').set(bearer(actors.reviewerA.token)).send({}).expect(403);
    });

    it('the assigned REVIEWER can read the application', async () => {
      await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.reviewerA.token)).expect(200);
    });

    it('an unassigned REVIEWER cannot read the application', async () => {
      await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.reviewerB.token)).expect(404);
    });

    it('REVIEWER list contains only assigned applications', async () => {
      await createApplication(app, actors.salesB.token);
      const res = await http().get('/applications').set(bearer(actors.reviewerA.token)).expect(200);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([appOfSalesA.id]);

      const other = await http().get('/applications').set(bearer(actors.reviewerB.token)).expect(200);
      expect(other.body.meta.total).toBe(0);
    });

    it('even the assigned REVIEWER cannot edit application data', async () => {
      await forceApplicationState(dataSource, appOfSalesA.id, { status: ApplicationStatus.NEEDS_INFORMATION });
      await http()
        .patch(`/applications/${appOfSalesA.id}`)
        .set(bearer(actors.reviewerA.token))
        .send({ businessName: 'Edited by reviewer' })
        .expect(403);
    });
  });

  describe('ADMIN', () => {
    it('ADMIN can read any application', async () => {
      await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.admin.token)).expect(200);
    });

    it('ADMIN lists applications of every SALES user', async () => {
      await createApplication(app, actors.salesB.token);
      const res = await http().get('/applications').set(bearer(actors.admin.token)).expect(200);
      expect(res.body.meta.total).toBe(2);
    });

    it('ADMIN can edit an editable application', async () => {
      await http()
        .patch(`/applications/${appOfSalesA.id}`)
        .set(bearer(actors.admin.token))
        .send({ businessName: 'Corrected by admin' })
        .expect(200);
    });
  });

  describe('review decisions (only the assigned REVIEWER)', () => {
    beforeEach(async () => {
      await forceApplicationState(dataSource, appOfSalesA.id, {
        status: ApplicationStatus.UNDER_REVIEW,
        riskStatus: ApplicationRiskStatus.CLEAR,
        assignedReviewerId: actors.reviewerA.user.id,
      });
    });

    const decide = (token: string, decision = 'APPROVE') =>
      http().post(`/applications/${appOfSalesA.id}/decisions`).set(bearer(token)).send({ decision, comment: 'Reason' });
    const storedStatus = async () =>
      (await dataSource.getRepository(MerchantApplication).findOneByOrFail({ id: appOfSalesA.id })).status;

    it.each(['APPROVE', 'REJECT', 'REQUEST_INFO'])('SALES (even the owner) cannot %s', async (decision) => {
      await decide(actors.salesA.token, decision).expect(403);
      expect(await storedStatus()).toBe(ApplicationStatus.UNDER_REVIEW);
    });

    it('ADMIN cannot record a decision', async () => {
      await decide(actors.admin.token).expect(403);
      expect(await storedStatus()).toBe(ApplicationStatus.UNDER_REVIEW);
    });

    it('an unassigned REVIEWER cannot record a decision', async () => {
      await decide(actors.reviewerB.token).expect(404);
      expect(await storedStatus()).toBe(ApplicationStatus.UNDER_REVIEW);
    });

    it('the assigned REVIEWER can record a decision', async () => {
      const res = await decide(actors.reviewerA.token).expect(201);
      expect(res.body).toMatchObject({ reviewerId: actors.reviewerA.user.id, applicationStatus: ApplicationStatus.APPROVED });
    });

    it('a REVIEWER loses access as soon as the application is reassigned', async () => {
      await http()
        .post(`/applications/${appOfSalesA.id}/assign-reviewer`)
        .set(bearer(actors.admin.token))
        .send({ reviewerId: actors.reviewerB.user.id })
        .expect(200);

      await decide(actors.reviewerA.token).expect(404);
      await http().get(`/applications/${appOfSalesA.id}`).set(bearer(actors.reviewerA.token)).expect(404);
      await decide(actors.reviewerB.token).expect(201);
    });
  });

  describe('reviewer assignment (ADMIN only)', () => {
    beforeEach(async () => {
      await forceApplicationState(dataSource, appOfSalesA.id, { status: ApplicationStatus.SUBMITTED });
    });

    it.each(['salesA', 'reviewerA'] as const)('%s cannot assign a reviewer', async (who) => {
      await http()
        .post(`/applications/${appOfSalesA.id}/assign-reviewer`)
        .set(bearer(actors[who].token))
        .send({ reviewerId: actors.reviewerA.user.id })
        .expect(403);
    });

    it('a REVIEWER cannot assign an application to themselves', async () => {
      await http()
        .post(`/applications/${appOfSalesA.id}/assign-reviewer`)
        .set(bearer(actors.reviewerB.token))
        .send({ reviewerId: actors.reviewerB.user.id })
        .expect(403);
      const stored = await dataSource.getRepository(MerchantApplication).findOneByOrFail({ id: appOfSalesA.id });
      expect(stored.assignedReviewerId).toBeNull();
    });
  });

  describe('GET /users/reviewers', () => {
    it('ADMIN gets the active reviewers (no sensitive fields)', async () => {
      const res = await http().get('/users/reviewers').set(bearer(actors.admin.token)).expect(200);
      expect(res.body.map((r: { id: string }) => r.id).sort()).toEqual([actors.reviewerA.user.id, actors.reviewerB.user.id].sort());
      expect(Object.keys(res.body[0]).sort()).toEqual(['email', 'fullName', 'id']);
    });

    it.each(['salesA', 'reviewerA'] as const)('%s cannot list users', async (who) => {
      await http().get('/users/reviewers').set(bearer(actors[who].token)).expect(403);
    });
  });

  it('rejects a malformed id with 400 before touching the database', async () => {
    await http().get('/applications/not-a-uuid').set(bearer(actors.admin.token)).expect(400);
  });
});
