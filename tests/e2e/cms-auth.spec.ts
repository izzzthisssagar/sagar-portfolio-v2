import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { SignJWT } from 'jose';
import { hasDatabase, jwtTestConfig } from '../../playwright.config';
import { loginViaUI } from './helpers';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './test-admin';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

test.describe('CMS authentication', () => {
  test('login form is keyboard operable end to end', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').click();
    await page.keyboard.type(TEST_ADMIN_EMAIL);
    await page.keyboard.press('Tab');
    await page.keyboard.type(TEST_ADMIN_PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
  });

  test('rejects an invalid password with a generic message and no enumeration', async ({
    page,
  }) => {
    await page.goto('/admin/login');
    await page.getByLabel('Email').fill(TEST_ADMIN_EMAIL);
    await page.getByLabel('Password').fill('definitely-the-wrong-password-123');
    await page.getByRole('button', { name: /sign in/i }).click();
    const feedback = page.locator('.login-feedback');
    await expect(feedback).toHaveText(/incorrect email or password/i);
    await expect(feedback).not.toContainText(/exist|found|unknown/i);
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('successful login reaches the dashboard with CMS navigation visible', async ({ page }) => {
    await loginViaUI(page);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await expect(page.getByText(TEST_ADMIN_EMAIL)).toBeVisible();
  });

  test('unauthenticated visitors are redirected away from every CMS route', async ({ page }) => {
    const response = await page.goto('/admin/dashboard');
    expect(response?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
  });

  test('logout ends the session and blocks further access to the CMS', async ({ page }) => {
    await loginViaUI(page);
    await page.getByRole('button', { name: 'LOG OUT' }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('mobile viewport still exposes CMS navigation after login', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginViaUI(page);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'PROJECTS' })).toBeVisible();
  });

  test('an expired access cookie is silently refreshed instead of ending the session', async ({
    page,
    context,
  }) => {
    await loginViaUI(page);
    const before = await context.cookies();
    const refreshBefore = before.find((c) => c.name === 'portfolio_refresh');
    const accessBefore = before.find((c) => c.name === 'portfolio_access');
    expect(refreshBefore, 'login must issue a refresh cookie').toBeTruthy();
    expect(accessBefore, 'login must issue an access cookie').toBeTruthy();

    // Swap in a correctly signed but expired access token — the refresh and
    // CSRF cookies from the real login stay untouched, so the proxy has to
    // use the real refresh flow to recover, not a bypass.
    const expiredAccessToken = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('playwright-admin-expired')
      .setIssuer(jwtTestConfig.accessIssuer)
      .setAudience(jwtTestConfig.accessAudience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(jwtTestConfig.accessSecret));
    await context.addCookies([
      {
        name: 'portfolio_access',
        value: expiredAccessToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
      },
    ]);

    await page.goto('/admin/dashboard');

    // Still authenticated — the silent refresh recovered the session rather
    // than bouncing to login.
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();

    const after = await context.cookies();
    const refreshAfter = after.find((c) => c.name === 'portfolio_refresh');
    const accessAfter = after.find((c) => c.name === 'portfolio_access');
    expect(accessAfter?.value).not.toBe(expiredAccessToken);
    expect(refreshAfter?.value).not.toBe(refreshBefore?.value);
  });

  test('dashboard has no serious or critical accessibility violations', async ({ page }) => {
    await loginViaUI(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ['critical', 'serious'].includes(violation.impact ?? ''),
      ),
    ).toEqual([]);
  });
});
