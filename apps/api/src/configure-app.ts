import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ErrorEnvelopeFilter } from './shared';

/**
 * Single place that assembles the HTTP pipeline (helmet, cookies, CORS,
 * prefix, validation, error envelope) shared by the real bootstrap and every
 * test harness — so tests exercise the same request pipeline production
 * traffic does, including cookie parsing the auth endpoints depend on.
 */
export function configureApp(app: INestApplication) {
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
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  return app;
}
