import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

interface DatabaseEnv {
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
}

// Shared by the Nest app and the TypeORM CLI so both always see the same schema.
// Schema changes go through reviewed migrations only; `synchronize` stays off everywhere.
export function buildDataSourceOptions(env: DatabaseEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT),
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  };
}
