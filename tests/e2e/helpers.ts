import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './test-admin';

export async function loginViaUI(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(TEST_ADMIN_EMAIL);
  await page.getByLabel('Password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}
