import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import * as argon2 from 'argon2';
import { SignJWT } from 'jose';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';
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

  test('logout-all in one browser context immediately locks out another already-authenticated context', async ({
    browser,
  }) => {
    // Uses its own dedicated admin (created directly via Prisma, bypassing
    // both the single-admin `admin:create` CLI guard and — since it's a
    // second row alongside the already-provisioned TEST_ADMIN — that same
    // guard's blanket "any admin already exists" check) rather than the
    // shared TEST_ADMIN_EMAIL — this test revokes every session for
    // whichever admin it logs in as, which would otherwise be able to yank
    // the rug out from under any other e2e test running concurrently in a
    // different worker against the same shared admin.
    const prisma = new PrismaService();
    await prisma.$connect();
    const email = `two-context-admin-${Date.now()}@example.invalid`;
    const password = 'Two-Context-Admin-Password-9!';
    try {
      await prisma.adminUser.create({
        data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
      });

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();
      try {
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        for (const page of [pageA, pageB]) {
          await page.goto('/admin/login');
          await page.getByLabel('Email').fill(email);
          await page.getByLabel('Password').fill(password);
          await page.getByRole('button', { name: /sign in/i }).click();
          await expect(page).toHaveURL(/\/admin\/dashboard$/);
        }
        await expect(pageB.getByRole('navigation', { name: 'Admin' })).toBeVisible();

        // Context A revokes every session for this admin, including B's.
        await pageA.getByRole('button', { name: 'REVOKE ALL SESSIONS' }).click();
        await pageA.getByRole('button', { name: 'REVOKE ALL', exact: true }).click();
        await expect(pageA).toHaveURL(/\/admin\/login/);

        // Context B, still holding its now-database-revoked access cookie,
        // navigates again — the live /auth/session check in the CMS layout
        // must reject it and redirect to login, and CMS navigation must
        // never render on the way there.
        await pageB.goto('/admin/dashboard');
        await expect(pageB).toHaveURL(/\/admin\/login/);
        await expect(pageB.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
      } finally {
        await contextA.close();
        await contextB.close();
      }
    } finally {
      await prisma.adminUser.deleteMany({ where: { email } });
      await prisma.$disconnect();
    }
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
    const expiredAccessToken = await new SignJWT({ role: 'admin', tokenVersion: 0 })
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
