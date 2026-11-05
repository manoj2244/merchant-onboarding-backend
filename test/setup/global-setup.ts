import './test-env';
import { DataSource } from 'typeorm';
import { validateEnv } from '../../src/config/env.validation';
import { buildDataSourceOptions } from '../../src/database/typeorm.config';

/** Applies the real migrations to the test database once per run (the same path production uses). */
export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(validateEnv(process.env)));
  await dataSource.initialize();
  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
