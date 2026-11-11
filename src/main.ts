import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { readEnvironment } from './config/environment.js';

try {
  const environment = readEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: true,
  });
  const pool = configureApp(app, environment);
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // Nest's default body limit applies; credentials never reach an access logger.
  await app.listen(environment.PORT, '0.0.0.0');
  const closePool = () => {
    void pool.end();
  };
  process.once('SIGTERM', closePool);
  process.once('SIGINT', closePool);
} catch {
  console.error(
    'Backend startup failed; check configuration and database availability',
  );
  process.exitCode = 1;
}
