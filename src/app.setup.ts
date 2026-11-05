import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

/** HTTP-level setup shared by main.ts and the e2e tests, so tests exercise the real app. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Merchant Onboarding & Risk Review API')
    .setDescription('Internal API for SALES, REVIEWER and ADMIN users to manage merchant applications.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
