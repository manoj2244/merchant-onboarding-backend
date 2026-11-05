import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApplicationStatus } from '../src/applications/application.enums';
import { MerchantApplication } from '../src/applications/entities/merchant-application.entity';
import {
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
        await http()
          .post('/applications')
          .set(bearer(actors.salesA.token))
          .send({ ...field, businessName: 'x' })
          .expect(400);
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

  it('rejects a malformed id with 400 before touching the database', async () => {
    await http().get('/applications/not-a-uuid').set(bearer(actors.admin.token)).expect(400);
  });
});
