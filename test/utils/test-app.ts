import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
}

/** Boots the real AppModule (guards, pipes, filters, DB, queue) with optional provider overrides. */
export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestContext> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) builder = override(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return { app, dataSource: app.get(DataSource) };
}
