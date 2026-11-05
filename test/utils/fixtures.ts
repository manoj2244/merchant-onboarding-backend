import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
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
