import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * `@nestjs/throttler`'s `ThrottlerGuard` is registered globally (`APP_GUARD`) and runs before any
 * route-specific guard, incrementing its per-route budget for every request that reaches
 * `canActivate` regardless of what the handler (or a later guard) eventually returns — so these
 * tests can prove each route's own budget using invalid/unauthenticated requests, without needing
 * real credentials or a real uploaded file, and without waiting out a real 60s window.
 */
const fakePrisma = {
  adminUser: { findUnique: () => Promise.resolve(null) },
  $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
};

describe('Route-aware rate-limit policy', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  const server = () => app.getHttpServer();

  /** Sequential, not concurrent — a burst of dozens of simultaneous connections against an
   * in-process supertest server is itself flaky (connection resets unrelated to the throttle
   * logic under test), and the throttle counter is inherently sequential state regardless. */
  async function fireSequentially(count: number, send: () => request.Test) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) {
      const res = await send();
      statuses.push(res.status);
    }
    return statuses;
  }

  it('health probes are exempt from every rate-limit budget', async () => {
    // Comfortably above the production global default (60/60s) — none of these should ever 429.
    const statuses = await fireSequentially(70, () => request(server()).get('/api/v1/health/live'));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('the login route enforces its own strict budget (20/60s) independent of the global default', async () => {
    const statuses = await fireSequentially(21, () =>
      request(server()).post('/api/v1/auth/login').send({ email: 'x', password: 'y' }),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('the refresh route enforces its own budget (30/60s), stricter than the global default', async () => {
    const statuses = await fireSequentially(31, () =>
      request(server()).post('/api/v1/auth/refresh').send({}),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('media upload enforces its own low budget (20/60s) regardless of authentication', async () => {
    const statuses = await fireSequentially(21, () =>
      request(server()).post('/api/v1/admin/media').send(),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('a 429 response includes a Retry-After header and a safe, non-leaking error code', async () => {
    let throttled: request.Response | undefined;
    for (let i = 0; i < 21; i++) {
      const res = await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'x', password: 'y' });
      if (res.status === 429) {
        throttled = res;
        break;
      }
    }
    expect(throttled).toBeTruthy();
    expect(throttled?.headers['retry-after']).toBeTruthy();
    expect(throttled?.body.error.code).toBe('HTTP_429');
    expect(JSON.stringify(throttled?.body)).not.toMatch(/throttler|storage|internal/i);
  });
});
