import type { Browser, BrowserContext, Cookie, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './test-admin';

export async function loginViaUI(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(TEST_ADMIN_EMAIL);
  await page.getByLabel('Password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

/**
 * `/api/v1/auth/login` carries its own strict per-route rate limit (20 requests/60s —
 * docs/security-production.md), deliberately independent of the raised E2E-only `RATE_LIMIT_MAX`
 * global default (playwright.config.ts) and never loosened for test convenience. The full e2e
 * suite runs every spec file sequentially against one shared API process (`workers: 1`), so every
 * real UI login anywhere in the suite counts against that same one 20/60s budget together — a
 * spec file that only needs an authenticated session as setup (not testing login itself) should
 * log in once via this real UI flow (never a forged/bypass token) and reuse the resulting cookies
 * across its other tests via `useSharedSession`, rather than calling `loginViaUI` fresh per test.
 * Files that specifically exercise login/logout mechanics (cms-auth.spec.ts) are the exception —
 * those need a fresh real login per case and stay well under the budget on their own.
 */
export async function loginOnceAndCaptureCookies(browser: Browser): Promise<Cookie[]> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginViaUI(page);
    return await context.cookies();
  } finally {
    await context.close();
  }
}

export async function useSharedSession(context: BrowserContext, cookies: Cookie[]): Promise<void> {
  await context.addCookies(cookies);
}
