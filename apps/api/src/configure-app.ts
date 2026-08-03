import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { getConfig } from './config';
import { createAccessLogMiddleware } from './logging/access-log.middleware';
import { requestIdMiddleware } from './logging/request-id';
import { StructuredLogger } from './logging/structured-logger';
import { buildHelmetMiddleware, permissionsPolicyMiddleware } from './security-headers';
import { ErrorEnvelopeFilter } from './shared';

export function buildStructuredLogger(): StructuredLogger {
  const env = getConfig();
  return new StructuredLogger({
    serviceName: env.SERVICE_NAME,
    releaseSha: env.RELEASE_SHA,
    format: env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty'),
    level: env.LOG_LEVEL,
  });
}

/**
 * Single place that assembles the HTTP pipeline (helmet, cookies, CORS,
 * prefix, validation, error envelope) shared by the real bootstrap and every
 * test harness — so tests exercise the same request pipeline production
 * traffic does, including cookie parsing the auth endpoints depend on.
 */
export function configureApp(app: INestApplication) {
  const env = getConfig();
  const logger = buildStructuredLogger();

  // Never inferred — see docs/security-production.md. `false` (the default, and Express's own
  // default) means `req.ip`/`req.ips` reflect the direct socket address only, ignoring any
  // X-Forwarded-For a client could otherwise spoof. `"1"` trusts exactly one upstream hop, the
  // only topology this deployment documents support for (one reverse proxy in front).
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', env.TRUST_PROXY === '1' ? 1 : false);

  // Request id first — every later middleware/filter (the access log, the error envelope) reads
  // `req.id`, which must already exist by the time they run.
  app.use(requestIdMiddleware);
  app.use(createAccessLogMiddleware(logger));
  app.use(buildHelmetMiddleware({ production: env.NODE_ENV === 'production' }));
  app.use(permissionsPolicyMiddleware);
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ErrorEnvelopeFilter(logger));
  return app;
}
