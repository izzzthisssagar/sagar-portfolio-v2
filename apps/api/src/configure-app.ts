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
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  return app;
}
