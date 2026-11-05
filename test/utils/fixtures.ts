import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { BusinessType } from '../../src/applications/application.enums';
import { MerchantApplication } from '../../src/applications/entities/merchant-application.entity';
import { User } from '../../src/users/entities/user.entity';
import { hashPassword } from '../../src/users/password';
import { Role } from '../../src/users/role.enum';

/** Fixture password for throwaway users in the isolated test database only. */
export const TEST_PASSWORD = 'test-fixture-password';
let cachedHash: Promise<string> | undefined;
const fixtureHash = () => (cachedHash ??= hashPassword(TEST_PASSWORD));

export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE audit_logs, review_decisions, risk_assessments, merchant_applications, users RESTART IDENTITY CASCADE',
  );
}

export async function createUser(
  dataSource: DataSource,
  role: Role,
  email: string,
  opts: { isActive?: boolean } = {},
): Promise<User> {
  const repo = dataSource.getRepository(User);
  return repo.save(
    repo.create({
      email,
      fullName: `Test ${role.toLowerCase()}`,
      role,
      passwordHash: await fixtureHash(),
      isActive: opts.isActive ?? true,
    }),
  );
}

export async function loginAs(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return res.body.accessToken as string;
}

export interface Actor {
  user: User;
  token: string;
}

export interface StandardActors {
  admin: Actor;
  salesA: Actor;
  salesB: Actor;
  reviewerA: Actor;
  reviewerB: Actor;
}

/** The cast every authorization test needs: two of each role that has object-level rules. */
export async function createStandardActors(app: INestApplication, dataSource: DataSource): Promise<StandardActors> {
  const make = async (role: Role, email: string): Promise<Actor> => {
    const user = await createUser(dataSource, role, email);
    return { user, token: await loginAs(app, email) };
  };
  return {
    admin: await make(Role.ADMIN, 'admin@example.com'),
    salesA: await make(Role.SALES, 'sales.a@example.com'),
    salesB: await make(Role.SALES, 'sales.b@example.com'),
    reviewerA: await make(Role.REVIEWER, 'reviewer.a@example.com'),
    reviewerB: await make(Role.REVIEWER, 'reviewer.b@example.com'),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Obviously fictitious merchant data (example.com, TEST- tax ids, 555 numbers). */
export function applicationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    businessName: 'Example Coffee Roasters',
    legalBusinessName: 'Example Coffee Roasters Pvt. Ltd.',
    businessType: BusinessType.LLC,
    website: 'https://coffee.example.com',
    ownerFullName: 'Jane Example',
    ownerEmail: 'jane.owner@example.com',
    ownerPhone: '+15550101234',
    ownerTaxId: 'TEST-000-1234',
    requestedMonthlyVolume: 50000,
    averageTicketSize: 25.5,
    mcc: '5814',
    currency: 'USD',
    ...overrides,
  };
}

export async function createApplication(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string } & Record<string, unknown>> {
  const res = await request(app.getHttpServer())
    .post('/applications')
    .set(bearer(token))
    .send(applicationPayload(overrides))
    .expect(201);
  return res.body;
}

/**
 * Arrange helper: puts an application directly into a given state, so a test can focus on one
 * transition without replaying the whole workflow. Lifecycle tests use the real endpoints instead.
 */
export async function forceApplicationState(
  dataSource: DataSource,
  id: string,
  patch: Partial<Pick<MerchantApplication, 'status' | 'riskStatus' | 'assignedReviewerId' | 'submissionCount'>>,
): Promise<void> {
  await dataSource.getRepository(MerchantApplication).update(id, patch);
}
