import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { EnvironmentVariables, NodeEnv } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  configureApp(app);
  if (config.get('NODE_ENV') !== NodeEnv.Production) {
    setupSwagger(app);
  }

  await app.listen(config.get('PORT'));
}

void bootstrap();
