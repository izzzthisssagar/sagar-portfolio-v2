import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

// A minimal, valid 1x1 PNG — the upload pipeline inspects magic bytes, so a
// fake/garbage buffer would be rejected before this spec ever reaches the
// approve/reject/delete flow it's actually testing. The pipeline dedupes
// uploads by the SHA-256 of the exact bytes sent (see media-validation.ts),
// so each call needs distinct bytes or it silently returns an existing row
// instead of creating a new one — trailing bytes appended after the PNG's
// IEND chunk change the hash without breaking decoding (ignored, per spec).
const BASE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
function uniquePng(): Buffer {
  return Buffer.concat([BASE_PNG, Buffer.from(`e2e-${Date.now()}-${Math.random()}`)]);
}

test.describe('CMS media pipeline', () => {
  test('uploads to quarantine, blocks unapproved public access, approves, then serves publicly', async ({
    page,
    request,
  }) => {
    await loginViaUI(page);
    await page.goto('/admin/media');

    await page
      .getByLabel('Upload image or PDF (drag and drop, or choose a file)')
      .setInputFiles({ name: 'e2e-upload.png', mimeType: 'image/png', buffer: uniquePng() });
    await expect(page.getByText('Quarantined').first()).toBeVisible();

    await page.getByText('e2e-upload.png').first().click();
    await expect(page).toHaveURL(/\/admin\/media\/[a-z0-9]+$/);
    const mediaId = page.url().split('/').pop();

    // Quarantined media is never reachable through the public delivery route.
    const beforeApproval = await request.get(`http://127.0.0.1:4000/api/v1/media/${mediaId}/file`);
    expect(beforeApproval.status()).toBe(404);

    await page.getByLabel('Alt text', { exact: true }).fill('An automated end-to-end test image.');
    await page.getByRole('button', { name: 'APPROVE' }).click();
    await expect(page.getByText('Approved').first()).toBeVisible();

    const afterApproval = await request.get(`http://127.0.0.1:4000/api/v1/media/${mediaId}/file`);
    expect(afterApproval.ok()).toBe(true);
    expect(afterApproval.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

    // Approved media attached to nothing can be deleted outright.
    await page.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
    await expect(page).toHaveURL(/\/admin\/media$/);
  });

  test('rejects with a reason, and rejected media never becomes public', async ({
    page,
    request,
  }) => {
    await loginViaUI(page);
    await page.goto('/admin/media');

    await page
      .getByLabel('Upload image or PDF (drag and drop, or choose a file)')
      .setInputFiles({ name: 'e2e-reject.png', mimeType: 'image/png', buffer: uniquePng() });
    await page.getByText('e2e-reject.png').first().click();
    await expect(page).toHaveURL(/\/admin\/media\/[a-z0-9]+$/);
    const mediaId = page.url().split('/').pop();

    await page.getByRole('button', { name: 'REJECT' }).click();
    await page.getByLabel('Rejection reason').fill('Not relevant evidence — automated test.');
    await page.getByRole('button', { name: 'CONFIRM REJECTION' }).click();
    await expect(page.getByText('Rejected').first()).toBeVisible();

    const publicFile = await request.get(`http://127.0.0.1:4000/api/v1/media/${mediaId}/file`);
    expect(publicFile.status()).toBe(404);

    await page.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
  });
});
