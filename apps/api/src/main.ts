import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildStructuredLogger, configureApp } from './configure-app';
import { getConfig } from './config';
import { registerGracefulShutdown } from './shutdown';

export async function bootstrap() {
  // Validated before anything else starts (Nest, Prisma, the HTTP listener) — a malformed or
  // incomplete environment fails immediately with a readable message, never a partially-started
  // process serving traffic against broken configuration.
  const env = getConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Nest's own lifecycle/module-init logs were buffered (`bufferLogs: true`) until now — this
  // flushes them through the same structured/redacted pipeline as application logging, not the
  // framework's plain-text default.
  app.useLogger(buildStructuredLogger());
  configureApp(app);
  // Runs every OnModuleDestroy hook (Prisma's disconnect among them) when the app closes —
  // without this, registerGracefulShutdown's app.close() would stop accepting requests but
  // never actually close the database connection.
  app.enableShutdownHooks();
  // Never mounted in production — an admin API's full route/schema map is not something to
  // expose at a public URL, and Swagger UI's own bundled inline script is incompatible with the
  // strict script-src the production CSP enforces everywhere else (see security-headers.ts).
  // Available in every other environment for local/staging convenience.
  if (env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Sagar Portfolio API')
      .setVersion('1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));
  }
  await app.listen(env.PORT);
  registerGracefulShutdown(app, { gracePeriodMs: env.SHUTDOWN_GRACE_PERIOD_MS });
  return app;
}
if (process.env.NODE_ENV !== 'test') void bootstrap();
