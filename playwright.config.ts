import { defineConfig } from '@playwright/test';

const accessSecret =
  process.env.ACCESS_TOKEN_SECRET ?? 'playwright-only-access-token-secret-32-chars';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? 'playwright-portfolio-api';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? 'playwright-portfolio-cms';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter @portfolio/web dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    env: {
      ACCESS_TOKEN_SECRET: accessSecret,
      ACCESS_TOKEN_ISSUER: accessIssuer,
      ACCESS_TOKEN_AUDIENCE: accessAudience,
    },
  },
});

export const jwtTestConfig = { accessSecret, accessIssuer, accessAudience };
