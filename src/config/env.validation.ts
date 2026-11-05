import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  PORT: number = 3000;

  @IsString()
  LOG_LEVEL: string = 'info';

  @IsString()
  DATABASE_HOST: string;

  @IsInt()
  DATABASE_PORT: number;

  @IsString()
  DATABASE_USER: string;

  @IsString()
  DATABASE_PASSWORD: string;

  @IsString()
  DATABASE_NAME: string;

  @IsString()
  REDIS_HOST: string;

  @IsInt()
  REDIS_PORT: number;

  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB: number = 0;

  // A short secret makes HS256 tokens brute-forceable, so refuse to boot with one.
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string = '1h';

  @IsInt()
  @Min(1)
  LOGIN_RATE_LIMIT_PER_MINUTE: number = 10;

  @IsInt()
  @Min(1)
  @Max(10)
  RISK_JOB_ATTEMPTS: number = 3;

  @IsInt()
  @Min(0)
  RISK_JOB_BACKOFF_MS: number = 2000;

  @IsOptional()
  @IsString()
  SEED_USER_PASSWORD?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    // Report only which variables are invalid, never their values.
    const names = errors.map((e) => e.property).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return validated;
}
