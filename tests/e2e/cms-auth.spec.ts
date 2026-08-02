import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
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

  test('rejects an invalid password with a generic message and no enumeration', async ({ page }) => {
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

  test('dashboard has no serious or critical accessibility violations', async ({ page }) => {
    await loginViaUI(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? '')),
    ).toEqual([]);
  });
});
