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
});

export const jwtTestConfig = { accessSecret, accessIssuer, accessAudience };
export const hasDatabase = Boolean(databaseUrl);
