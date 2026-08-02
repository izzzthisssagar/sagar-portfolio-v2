import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

test.describe('CMS project workflow', () => {
  test('creates, previews as draft, publishes, becomes public, then deletes via a keyboard-operable confirm dialog', async ({
    page,
  }) => {
    const suffix = Date.now();
    const title = `E2E Project ${suffix}`;
    const slug = `e2e-project-${suffix}`;

    await loginViaUI(page);

    await page.goto('/admin/projects/new');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Slug').fill(slug);
    await page
      .getByLabel('Summary')
      .fill('A sufficiently long automated end-to-end test project summary.');
    await page.getByLabel('Overview').fill('Automated overview text written by the e2e suite.');
    await page.getByLabel('Responsibilities').fill('Wrote and executed this automated test.');
    await page.getByRole('button', { name: 'CREATE PROJECT' }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/(?!new$)[a-z0-9]+$/);

    // Draft preview is admin-only and clearly labelled.
    await page.getByRole('link', { name: 'PREVIEW DRAFT' }).click();
    await expect(page.getByText(/DRAFT PREVIEW/)).toBeVisible();

    // Not publicly reachable while still a draft.
    const draftResponse = await page.goto(`/work/${slug}`);
    expect(draftResponse?.status()).toBe(404);

    // Publish from the project list.
    await page.goto('/admin/projects');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: 'PUBLISH' }).click();
    await expect(row.getByText('Published')).toBeVisible();

    // Now publicly visible.
    const publicResponse = await page.goto(`/work/${slug}`);
    expect(publicResponse?.ok()).toBe(true);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    // Delete via the accessible confirmation dialog, keyboard-only.
    await page.goto('/admin/projects');
    const rowAfterPublish = page.getByRole('row', { name: new RegExp(title) });
    await rowAfterPublish.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row', { name: new RegExp(title) })).toBeVisible();

    await rowAfterPublish.getByRole('button', { name: 'DELETE' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    // The public page revalidates on a 60s cache, not instantly, so the
    // deleted-project 404 isn't re-asserted here; the row disappearing from
    // the admin list already confirms the delete took effect, and the
    // draft-hidden/published-visible boundary is covered by the API
    // integration suite and the "not publicly reachable while draft" check
    // above.
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
  });

  test('edits an existing project and persists the change', async ({ page }) => {
    const suffix = Date.now();
    const title = `E2E Edit Project ${suffix}`;
    const slug = `e2e-edit-project-${suffix}`;
    const updatedSummary = 'An updated automated end-to-end test project summary.';

    await loginViaUI(page);
    await page.goto('/admin/projects/new');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Slug').fill(slug);
    await page
      .locator('#field-summary')
      .fill('The original automated end-to-end test project summary.');
    await page.getByRole('button', { name: 'CREATE PROJECT' }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/(?!new$)[a-z0-9]+$/);

    const summaryField = page.locator('#field-summary');
    await summaryField.fill(updatedSummary);
    await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
    await expect(summaryField).toHaveValue(updatedSummary);
    await page.reload();
    await expect(summaryField).toHaveValue(updatedSummary);

    // Cleanup.
    await page.goto('/admin/projects');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
  });
});
