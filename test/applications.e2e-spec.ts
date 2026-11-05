import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { ApplicationRiskStatus, ApplicationStatus } from '../src/applications/application.enums';
import { AuditAction } from '../src/audit/audit.constants';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
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

describe('Merchant applications (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let actors: StandardActors;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    actors = await createStandardActors(app, dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auditFor = (entityId: string) =>
    dataSource.getRepository(AuditLog).find({ where: { entityId }, order: { createdAt: 'ASC' } });

  describe('create', () => {
    it('creates a DRAFT application owned by the caller', async () => {
      const res = await http().post('/applications').set(bearer(actors.salesA.token)).send(applicationPayload()).expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        businessName: 'Example Coffee Roasters',
        status: ApplicationStatus.DRAFT,
        riskStatus: ApplicationRiskStatus.NOT_STARTED,
        submissionCount: 0,
        createdById: actors.salesA.user.id,
        assignedReviewerId: null,
        requestedMonthlyVolume: 50000,
        averageTicketSize: 25.5,
        ownerTaxIdMasked: '****1234',
      });
      expect(res.body).not.toHaveProperty('ownerTaxId');
      expect(JSON.stringify(res.body)).not.toContain('TEST-000-1234');
    });

    it('records an APPLICATION_CREATED audit entry with masked PII', async () => {
      const created = await createApplication(app, actors.salesA.token);
      const [entry, ...rest] = await auditFor(created.id);

      expect(rest).toHaveLength(0);
      expect(entry).toMatchObject({ action: AuditAction.APPLICATION_CREATED, actorId: actors.salesA.user.id });
      const stored = JSON.stringify(entry.metadata);
      expect(stored).toContain('****1234');
      expect(stored).not.toContain('TEST-000-1234');
      expect(stored).not.toContain('jane.owner@example.com');
      expect(stored).not.toContain('+15550101234');
    });

    it.each([
      ['a negative volume', { requestedMonthlyVolume: -1 }],
      ['too many decimals', { averageTicketSize: 1.234 }],
      ['a non-E.164 phone', { ownerPhone: '555-0101' }],
      ['an invalid MCC', { mcc: '58A4' }],
      ['an unknown currency', { currency: 'XXQ' }],
      ['an unknown business type', { businessType: 'TRUST' }],
      ['a missing business name', { businessName: undefined }],
    ])('rejects %s with 400', async (_label, overrides) => {
      await http().post('/applications').set(bearer(actors.salesA.token)).send(applicationPayload(overrides)).expect(400);
    });
  });

  describe('update', () => {
    it('updates a DRAFT application and audits only the changed fields, masked', async () => {
      const created = await createApplication(app, actors.salesA.token);

      const res = await http()
        .patch(`/applications/${created.id}`)
        .set(bearer(actors.salesA.token))
        .send({ businessName: 'Renamed Roasters', ownerTaxId: 'TEST-999-9876', mcc: '5814' })
        .expect(200);
      expect(res.body).toMatchObject({ businessName: 'Renamed Roasters', ownerTaxIdMasked: '****9876' });

      const entries = await auditFor(created.id);
      const update = entries.find((e) => e.action === AuditAction.APPLICATION_UPDATED);
      expect(update?.metadata).toEqual({
        changedFields: ['businessName', 'ownerTaxId'], // mcc was unchanged
        before: { businessName: 'Example Coffee Roasters', ownerTaxId: '****1234' },
        after: { businessName: 'Renamed Roasters', ownerTaxId: '****9876' },
      });
    });

    it('does not write an audit entry when nothing changed', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await http().patch(`/applications/${created.id}`).set(bearer(actors.salesA.token)).send({ mcc: '5814' }).expect(200);
      expect(await auditFor(created.id)).toHaveLength(1);
    });

    it('allows editing in NEEDS_INFORMATION', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await forceApplicationState(dataSource, created.id, { status: ApplicationStatus.NEEDS_INFORMATION });
      await http().patch(`/applications/${created.id}`).set(bearer(actors.salesA.token)).send({ website: 'https://new.example.com' }).expect(200);
    });

    it.each([ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW, ApplicationStatus.APPROVED, ApplicationStatus.REJECTED])(
      'rejects edits while %s with 409',
      async (status) => {
        const created = await createApplication(app, actors.salesA.token);
        await forceApplicationState(dataSource, created.id, { status });

        const res = await http()
          .patch(`/applications/${created.id}`)
          .set(bearer(actors.salesA.token))
          .send({ businessName: 'Too late' })
          .expect(409);
        expect(res.body.message).toBe(`Cannot edit an application in status ${status}`);
      },
    );
  });

  describe('list', () => {
    it('paginates newest first with stable metadata', async () => {
      const ids: string[] = [];
      for (let i = 1; i <= 5; i++) {
        ids.push((await createApplication(app, actors.salesA.token, { businessName: `Merchant ${i}` })).id);
      }

      const page1 = await http().get('/applications?page=1&limit=2').set(bearer(actors.salesA.token)).expect(200);
      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(page1.body.data.map((a: { businessName: string }) => a.businessName)).toEqual(['Merchant 5', 'Merchant 4']);

      const page3 = await http().get('/applications?page=3&limit=2').set(bearer(actors.salesA.token)).expect(200);
      expect(page3.body.data.map((a: { businessName: string }) => a.businessName)).toEqual(['Merchant 1']);

      const beyond = await http().get('/applications?page=4&limit=2').set(bearer(actors.salesA.token)).expect(200);
      expect(beyond.body.data).toEqual([]);
    });

    it('filters by status', async () => {
      const draft = await createApplication(app, actors.salesA.token);
      const underReview = await createApplication(app, actors.salesA.token);
      await forceApplicationState(dataSource, underReview.id, { status: ApplicationStatus.UNDER_REVIEW });

      const res = await http().get('/applications?status=UNDER_REVIEW').set(bearer(actors.salesA.token)).expect(200);
      expect(res.body.data.map((a: { id: string }) => a.id)).toEqual([underReview.id]);

      const drafts = await http().get('/applications?status=DRAFT').set(bearer(actors.salesA.token)).expect(200);
      expect(drafts.body.data.map((a: { id: string }) => a.id)).toEqual([draft.id]);
    });

    it.each(['limit=0', 'limit=101', 'page=0', 'status=UNKNOWN', 'page=abc'])('rejects invalid query %s', async (qs) => {
      await http().get(`/applications?${qs}`).set(bearer(actors.salesA.token)).expect(400);
    });
  });

  describe('audit trail', () => {
    it('is exposed to users who can see the application', async () => {
      const created = await createApplication(app, actors.salesA.token);
      const res = await http().get(`/applications/${created.id}/audit-logs`).set(bearer(actors.salesA.token)).expect(200);
      expect(res.body.map((e: { action: string }) => e.action)).toEqual([AuditAction.APPLICATION_CREATED]);
    });

    it('cannot be rewritten, even with direct database access', async () => {
      const created = await createApplication(app, actors.salesA.token);
      await expect(dataSource.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE entity_id = $1`, [created.id])).rejects.toThrow(
        'audit_logs is append-only',
      );
      await expect(dataSource.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [created.id])).rejects.toThrow(
        'audit_logs is append-only',
      );
    });
  });
});
