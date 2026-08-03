import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

test.describe('CMS Field Notes workflow', () => {
  test('creates a draft, keeps it unlisted publicly, publishes, becomes public, then deletes', async ({
    page,
  }) => {
    const suffix = Date.now();
    const title = `E2E Post ${suffix}`;
    const slug = `e2e-post-${suffix}`;

    await loginViaUI(page);

    await page.goto('/admin/posts/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Slug').fill(slug);
    await page
      .getByLabel('Excerpt')
      .fill('An excerpt long enough for the automated end-to-end test.');
    await page
      .getByLabel('Body (Markdown)')
      .fill('Automated end-to-end test body content for a Field Note.');
    await page.getByRole('button', { name: 'CREATE POST' }).click();
    await expect(page).toHaveURL(/\/admin\/posts\/(?!new$)[a-z0-9]+$/);

    // Not publicly reachable while still a draft.
    const draftResponse = await page.goto(`/notes/${slug}`);
    expect(draftResponse?.status()).toBe(404);

    // Publish from the post list.
    await page.goto('/admin/posts');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: 'PUBLISH' }).click();
    await expect(row.getByText('Published')).toBeVisible();

    // Now publicly visible, with Article JSON-LD.
    const publicResponse = await page.goto(`/notes/${slug}`);
    expect(publicResponse?.ok()).toBe(true);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const ldJson = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ldJson ?? '{}')).toMatchObject({ '@type': 'Article', headline: title });

    // Delete via the shared accessible confirmation dialog.
    await page.goto('/admin/posts');
    const rowAfterPublish = page.getByRole('row', { name: new RegExp(title) });
    await rowAfterPublish.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
  });
});
