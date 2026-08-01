import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('homepage exposes core content and no serious axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /turn assumptions/i })).toBeVisible();
  await page.getByRole('link', { name: 'INSPECT MY WORK' }).click();
  await expect(page).toHaveURL(/\/work$/);
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
  ).toEqual([]);
});
