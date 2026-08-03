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
  // control and is never touched here — this only raises the budget for the one API instance
  // this whole sequential 25-spec suite shares, which can exceed 60 of its own necessary
  // request volume within a single 60s window on its own (see docs/sprint-3.md "Known
  // limitations"). Only takes effect if this config actually spawns the API server (below);
  // when CI pre-starts it via a separate step (see .github/workflows/ci.yml), that step's own
  // env is what matters — this value is kept in sync with it.
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? '300',
};

// The API server (and the DB-backed specs in tests/e2e/cms.spec.ts) only
// start when a DATABASE_URL is available — CI always sets one; local runs
// without a database still get the DB-independent JWT-boundary specs.
const webServer: NonNullable<PlaywrightTestConfig['webServer']> = [
  ...(databaseUrl
    ? [
        {
          command: 'pnpm --filter @portfolio/api exec nest start',
          url: 'http://127.0.0.1:4000/api/v1/health',
          reuseExistingServer: true,
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
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer,
  // Every DB-backed spec shares one Next.js dev server, one Nest dev server,
  // one AdminUser row, and — this is the binding constraint — one app-wide
  // ThrottlerGuard budget (60 requests/60s per IP, apps/api/src/app.module.ts,
  // predates Sprint 3) that every request counts against together, since it's
  // all from the same machine. The suite's own necessary volume can exceed 60
  // within a single 60s window on its own — a tripped limit surfaces as an
  // unrelated-looking UI timeout (a failed upload, a login that never
  // resolves) rather than a visible 429. Pinning workers to 1 reduces
  // burstiness and is kept as a partial mitigation, but does not fully
  // eliminate the failure mode (see docs/sprint-3.md "Known limitations") —
  // loosening the production rate limit to chase e2e determinism isn't a
  // trade to make unilaterally here.
  workers: 1,
});

export const jwtTestConfig = { accessSecret, accessIssuer, accessAudience };
export const hasDatabase = Boolean(databaseUrl);
