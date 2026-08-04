import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const accessSecret =
  process.env.ACCESS_TOKEN_SECRET ?? 'playwright-only-access-token-secret-32-chars';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? 'playwright-portfolio-api';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? 'playwright-portfolio-cms';
const refreshSecret =
  process.env.REFRESH_TOKEN_SECRET ?? 'playwright-only-refresh-token-secret-32-chars';
const databaseUrl = process.env.DATABASE_URL ?? '';

const sharedEnv = {
  ACCESS_TOKEN_SECRET: accessSecret,
  ACCESS_TOKEN_ISSUER: accessIssuer,
  ACCESS_TOKEN_AUDIENCE: accessAudience,
  REFRESH_TOKEN_SECRET: refreshSecret,
  DATABASE_URL: databaseUrl,
  WEB_URL: 'http://127.0.0.1:3000',
  API_URL: 'http://127.0.0.1:4000',
  // The production default (60 req/60s/IP, apps/api/src/app.module.ts) is a real security
  // control and is never touched here — this only raises the budget for the one disposable API
  // instance this whole sequential 61-spec suite shares, which can exceed 60 of its own
  // necessary request volume within a single 60s window on its own. Measured directly (counting
  // this suite's own `http_request` access-log lines across one full clean local run): 299 API
  // requests total. 2000 keeps ~6x headroom above that measured figure — comfortable margin for
  // suite growth without being an arbitrarily huge number. See docs/sprint-4.md "E2E rate-limit
  // headroom". Only takes effect if this config actually spawns the API server (below); when CI
  // pre-starts it via a separate step (see .github/workflows/ci.yml), that step's own env is
  // what matters — this value is kept in sync with it. Route-specific budgets (login, contact,
  // refresh, media upload — each independently and deliberately stricter than the default) are
  // never affected by this value; see apps/api/test/rate-limit-e2e-override.api.integration.test.ts.
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? '2000',
};

// The API server (and every DB-backed spec) only starts when a DATABASE_URL is available — CI
// always sets one; local runs without a database still get the DB-independent JWT-boundary
// specs. `reuseExistingServer` is gated on E2E_REUSE_API_SERVER (default off, i.e. Playwright
// always starts its own fresh API process locally, or fails clearly if port 4000 is already
// occupied by something else) — set only by CI, which deliberately pre-starts the API itself
// (ahead of `pnpm build`, so Next's static generation has a real API to build against; see
// .github/workflows/ci.yml) and needs Playwright to attach to that same already-running,
// already-seeded process rather than spawning a second one. Without this gate, a stale local API
// process left running from an earlier, differently-configured session (e.g. without the raised
// RATE_LIMIT_MAX, or against a different database) would be silently reused, producing
// confusing, non-deterministic failures unrelated to whatever change is actually under test.
const reuseApiServer = process.env.E2E_REUSE_API_SERVER === 'true';
const webServer: NonNullable<PlaywrightTestConfig['webServer']> = [
  ...(databaseUrl
    ? [
        {
          command: 'pnpm --filter @portfolio/api exec nest start',
          url: 'http://127.0.0.1:4000/api/v1/health/live',
          reuseExistingServer: reuseApiServer,
          timeout: 60_000,
          env: { ...sharedEnv, PORT: '4000' },
        },
      ]
    : []),
  {
    command: 'pnpm --filter @portfolio/web dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { ...sharedEnv, NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000/api/v1' },
  },
];

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: databaseUrl ? './tests/e2e/global-setup.ts' : undefined,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The HTML report (and everything under test-results/ — traces, screenshots) is what
  // .github/workflows/ci.yml uploads on failure; kept terse ('list' only) for local runs, where
  // an HTML report nobody's about to open is just noise.
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  webServer,
  // Every DB-backed spec shares one Next.js dev server, one Nest dev server, one AdminUser row,
  // and one app-wide ThrottlerGuard budget (apps/api/src/app.module.ts) — since it's all from
  // the same machine, every request counts against the same budget together. The global default
  // is raised for this disposable process (RATE_LIMIT_MAX above), but the strict per-route login
  // budget (20/60s — deliberately never raised, see docs/security-production.md) is still shared
  // across the whole suite: spec files that only need an authenticated session as setup log in
  // once and reuse the session (tests/e2e/helpers.ts's loginOnceAndCaptureCookies), rather than
  // each test logging in fresh, to stay well under it. Pinning workers to 1 keeps every request
  // sequential (no concurrent bursts against that shared budget) and gives every test a
  // consistent, single-tab DOM/session state to assert against — see docs/sprint-4.md "E2E
  // rate-limit headroom" for how this suite reached a deterministic 61/61.
  workers: 1,
});

export const jwtTestConfig = { accessSecret, accessIssuer, accessAudience };
export const hasDatabase = Boolean(databaseUrl);
