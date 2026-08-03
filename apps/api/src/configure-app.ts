import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { getConfig } from './config';
import { createAccessLogMiddleware } from './logging/access-log.middleware';
import { requestIdMiddleware } from './logging/request-id';
import { StructuredLogger } from './logging/structured-logger';
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
  const logger = buildStructuredLogger();
  // Request id first — every later middleware/filter (the access log, the error envelope) reads
  // `req.id`, which must already exist by the time they run.
  app.use(requestIdMiddleware);
  app.use(createAccessLogMiddleware(logger));
  // Helmet's default Cross-Origin-Resource-Policy is `same-origin`, which blocks the browser
  // from loading cross-origin subresources like the admin media preview `<img src>` even though
  // CORS allows the request — CORP is a separate, browser-enforced check CORS headers don't
  // satisfy. `same-site` permits that (web:3000 -> api:4000 share a site, per the same-site
  // deployment assumption the cookie/CSRF design already relies on) without opening it to
  // genuinely cross-site origins.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ErrorEnvelopeFilter(logger));
  return app;
}
