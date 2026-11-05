import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Role } from '../src/users/role.enum';
import { bearer, createUser, loginAs, resetDatabase, TEST_PASSWORD } from './utils/fixtures';
import { createTestApp } from './utils/test-app';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let sales: User;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    sales = await createUser(dataSource, Role.SALES, 'sales@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('POST /auth/login', () => {
    it('issues a JWT for valid credentials and never returns the password hash', async () => {
      const res = await http().post('/auth/login').send({ email: 'sales@example.com', password: TEST_PASSWORD }).expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: '15m',
        user: { id: sales.id, email: 'sales@example.com', fullName: expect.any(String), role: Role.SALES },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it('treats the email case-insensitively and ignores surrounding spaces', async () => {
      await http().post('/auth/login').send({ email: 'SALES@Example.com', password: TEST_PASSWORD }).expect(200);
      await http().post('/auth/login').send({ email: '  sales@example.com ', password: TEST_PASSWORD }).expect(200);
    });

    it('rejects a wrong password with a generic 401', async () => {
      const res = await http().post('/auth/login').send({ email: 'sales@example.com', password: 'wrong-password' }).expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('returns the same 401 for an unknown email (no user enumeration)', async () => {
      const res = await http().post('/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD }).expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('rejects a deactivated user', async () => {
      await createUser(dataSource, Role.SALES, 'inactive@example.com', { isActive: false });
      await http().post('/auth/login').send({ email: 'inactive@example.com', password: TEST_PASSWORD }).expect(401);
    });

    it('validates the request body', async () => {
      const res = await http().post('/auth/login').send({ email: 'not-an-email' }).expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
    });

    it('rejects unknown properties in the body', async () => {
      await http()
        .post('/auth/login')
        .send({ email: 'sales@example.com', password: TEST_PASSWORD, role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('protected routes', () => {
    it('allows access with a valid token', async () => {
      const token = await loginAs(app, 'sales@example.com');
      const res = await http().get('/auth/me').set(bearer(token)).expect(200);
      expect(res.body).toMatchObject({ id: sales.id, role: Role.SALES });
    });

    it('rejects a request without a token', async () => {
      await http().get('/auth/me').expect(401);
    });

    it('rejects a malformed token', async () => {
      await http().get('/auth/me').set(bearer('not.a.jwt')).expect(401);
    });

    it('rejects a token signed with a different secret', async () => {
      const forged = new JwtService({ secret: 'x'.repeat(48) }).sign({ sub: sales.id, role: Role.ADMIN });
      await http().get('/auth/me').set(bearer(forged)).expect(401);
    });

    it('rejects an unsigned token (alg "none")', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: sales.id, role: Role.ADMIN })}.`;
      await http().get('/auth/me').set(bearer(unsigned)).expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = new JwtService({ secret: process.env.JWT_SECRET }).sign({
        sub: sales.id,
        role: Role.SALES,
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      await http().get('/auth/me').set(bearer(expired)).expect(401);
    });

    it('rejects a still-valid token once the user is deactivated', async () => {
      const token = await loginAs(app, 'sales@example.com');
      await dataSource.getRepository(User).update(sales.id, { isActive: false });
      await http().get('/auth/me').set(bearer(token)).expect(401);
    });

    it('takes the role from the database, not from the token claims', async () => {
      // A validly signed token whose payload claims ADMIN for a SALES user.
      const tampered = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: sales.id, role: Role.ADMIN });
      const res = await http().get('/auth/me').set(bearer(tampered)).expect(200);
      expect(res.body.role).toBe(Role.SALES);
    });

    it('keeps public routes public', async () => {
      await http().get('/health').expect(200);
    });
  });
});
