import { expect, test, type Cookie } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginOnceAndCaptureCookies, useSharedSession } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

test.describe('Contact form and admin inbox', () => {
  // One real UI login shared by both cases below — see helpers.ts's loginOnceAndCaptureCookies.
  let authCookies: Cookie[] = [];

  test.beforeAll(async ({ browser }) => {
    authCookies = await loginOnceAndCaptureCookies(browser);
  });

  test('a public submission is delivered and visible in the admin inbox, then can be deleted', async ({
    page,
    context,
  }) => {
    const suffix = Date.now();
    const name = `E2E Contact ${suffix}`;
    const subject = `E2E subject ${suffix}`;

    await page.goto('/contact');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill('e2e-contact@example.invalid');
    await page.getByLabel('Subject (optional)').fill(subject);
    await page
      .getByLabel('Message')
      .fill('An automated end-to-end test message submitted through the public contact form.');
    await page.getByRole('button', { name: 'SEND' }).click();
    await expect(page.getByRole('status')).toContainText('Message received');

    await useSharedSession(context, authCookies);
    await page.goto('/admin/messages');
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('new')).toBeVisible();
    await expect(row.getByText('delivered')).toBeVisible();

    await row.getByRole('link', { name: 'VIEW' }).click();
    await expect(page.getByRole('heading', { name: subject })).toBeVisible();
    await page.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
    await expect(page).toHaveURL(/\/admin\/messages$/);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });

  test('a filled honeypot is silently accepted but never reaches the admin inbox', async ({
    page,
    context,
  }) => {
    const suffix = Date.now();
    const name = `E2E Honeypot ${suffix}`;

    await page.goto('/contact');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Email').fill('e2e-honeypot@example.invalid');
    await page
      .getByLabel('Message')
      .fill('This submission fills the hidden honeypot field and must be silently dropped.');
    // The honeypot is hidden from sighted and assistive-tech users alike
    // (aria-hidden, not display:none) — a real visitor can never reach it,
    // only a bot filling every field blindly would.
    await page.locator('#website').fill('http://bot-filled-this-field.example');
    await page.getByRole('button', { name: 'SEND' }).click();
    await expect(page.getByRole('status')).toContainText('Message received');

    await useSharedSession(context, authCookies);
    await page.goto('/admin/messages');
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
  });
});
