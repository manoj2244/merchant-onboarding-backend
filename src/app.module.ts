import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { EnvironmentVariables, NodeEnv, validateEnv } from './config/env.validation';
import { buildDataSourceOptions } from './database/typeorm.config';
import { HealthModule } from './health/health.module';

type Config = ConfigService<EnvironmentVariables, true>;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: Config) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === NodeEnv.Test ? 'silent' : config.get('LOG_LEVEL'),
          // Request lines are written by LoggingInterceptor; pino only binds a minimal req context.
          autoLogging: false,
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.password',
              '*.passwordHash',
              '*.token',
              '*.accessToken',
              '*.ownerTaxId',
              '*.ownerEmail',
              '*.ownerPhone',
            ],
            censor: '[REDACTED]',
          },
          transport:
            config.get('NODE_ENV') === NodeEnv.Development ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: Config) => buildDataSourceOptions({
        DATABASE_HOST: config.get('DATABASE_HOST'),
        DATABASE_PORT: config.get('DATABASE_PORT'),
        DATABASE_USER: config.get('DATABASE_USER'),
        DATABASE_PASSWORD: config.get('DATABASE_PASSWORD'),
        DATABASE_NAME: config.get('DATABASE_NAME'),
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: Config) => ({
        connection: { host: config.get('REDIS_HOST'), port: config.get('REDIS_PORT') },
      }),
    }),
    HealthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
