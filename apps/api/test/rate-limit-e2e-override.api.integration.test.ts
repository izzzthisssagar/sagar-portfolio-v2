import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * `RATE_LIMIT_MAX` (apps/api/src/app.module.ts's `globalRateLimit()`) exists solely so a
 * disposable E2E test API process can raise its own app-wide default budget past the production
 * 60/60s — see playwright.config.ts and .github/workflows/ci.yml. This suite proves that raise is
 * exactly as narrow as intended: it lifts the *default* (routes with no `@Throttle` of their own)
 * but every route-specific policy (login, refresh, media upload, contact — each independently
 * documented as deliberately stricter than the default) keeps 429ing at its own low budget no
 * matter how high `RATE_LIMIT_MAX` is set. `ThrottlerModule.forRoot`'s limit is computed once, at
 * `AppModule` class-definition time, so `RATE_LIMIT_MAX` must be set *before* `AppModule` is
 * imported — a dynamic `import()` inside `beforeAll` (not a static top-of-file import, which ES
 * module hoisting would evaluate before this file's own `process.env` assignment runs).
 */
const fakePrisma = {
  adminUser: { findUnique: () => Promise.resolve(null) },
  project: { findMany: () => Promise.resolve([]), count: () => Promise.resolve(0) },
  $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
};

describe('Rate limit: a raised E2E-only global budget never overrides route-specific policy', () => {
  let app: INestApplication;
  const previousRateLimitMax = process.env.RATE_LIMIT_MAX;

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = '2000';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousRateLimitMax === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = previousRateLimitMax;
  });

  const server = () => app.getHttpServer();

  /** Sequential, not concurrent — matches rate-limit-policy.api.integration.test.ts's rationale:
   * a burst of simultaneous connections against an in-process supertest server is itself flaky,
   * and the throttle counter is inherently sequential state regardless. */
  async function fireSequentially(count: number, send: () => request.Test) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) {
      const res = await send();
      statuses.push(res.status);
    }
    return statuses;
  }

  it('a route with no @Throttle override honors the raised global budget past 60/60s', async () => {
    // GET /api/v1/projects carries no @Throttle of its own — it inherits whatever this process's
    // global default was started with. 70 sequential requests staying all-200 proves the raise
    // actually took effect app-wide, not just that this test process didn't crash.
    const statuses = await fireSequentially(70, () => request(server()).get('/api/v1/projects'));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('the login route still enforces its own 20/60s budget despite RATE_LIMIT_MAX=2000', async () => {
    const statuses = await fireSequentially(21, () =>
      request(server()).post('/api/v1/auth/login').send({ email: 'x', password: 'y' }),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('the refresh route still enforces its own 30/60s budget despite RATE_LIMIT_MAX=2000', async () => {
    const statuses = await fireSequentially(31, () =>
      request(server()).post('/api/v1/auth/refresh').send({}),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('the media upload route still enforces its own 20/60s budget despite RATE_LIMIT_MAX=2000', async () => {
    const statuses = await fireSequentially(21, () =>
      request(server()).post('/api/v1/admin/media').send(),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it('the contact route still enforces its own 20/60s budget despite RATE_LIMIT_MAX=2000', async () => {
    const statuses = await fireSequentially(21, () =>
      request(server()).post('/api/v1/contact').send({}),
    );
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
