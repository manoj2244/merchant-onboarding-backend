import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './typeorm.config';

// Entry point for the TypeORM CLI (migration:run / revert / generate).
export default new DataSource(buildDataSourceOptions(validateEnv(process.env)));
