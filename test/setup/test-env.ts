import { config } from 'dotenv';

/**
 * Runs before every e2e test file. Reuses connection settings from .env but points the app at
 * an isolated database and Redis DB, so the suite never touches development data.
 */
config({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_NAME = process.env.DATABASE_TEST_NAME ?? 'merchant_test';
process.env.REDIS_DB = '1';
process.env.RISK_JOB_ATTEMPTS = '3';
process.env.RISK_JOB_BACKOFF_MS = '50';
process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '1000';
process.env.JWT_EXPIRES_IN = '15m';
