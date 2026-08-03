import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

const BASE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
function uniquePng(): Buffer {
  return Buffer.concat([BASE_PNG, Buffer.from(`e2e-evidence-${Date.now()}-${Math.random()}`)]);
}
function uniquePdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Seed ${Date.now()}-${Math.random()}>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
    'latin1',
  );
}

test.describe('CMS project evidence gallery only accepts approved images', () => {
  test('an approved PDF never appears as an attachable option in the evidence gallery', async ({
    page,
  }) => {
    await loginViaUI(page);

    const imageName = `e2e-evidence-image-${Date.now()}.png`;
    const pdfName = `e2e-evidence-doc-${Date.now()}.pdf`;

    // Upload and approve an image — should become available as evidence.
    await page.goto('/admin/media');
    await page
      .getByLabel('Upload image or PDF (drag and drop, or choose a file)')
      .setInputFiles({ name: imageName, mimeType: 'image/png', buffer: uniquePng() });
    await page.getByText(imageName).first().click();
    await expect(page).toHaveURL(/\/admin\/media\/[a-z0-9]+$/);
    await page.getByLabel('Alt text', { exact: true }).fill('An automated evidence-gallery image.');
    await page.getByRole('button', { name: 'APPROVE' }).click();
    await expect(page.getByText('Approved').first()).toBeVisible();

    // Upload and approve a PDF document — same pipeline, same APPROVED status.
    await page.goto('/admin/media');
    await page
      .getByLabel('Upload image or PDF (drag and drop, or choose a file)')
      .setInputFiles({ name: pdfName, mimeType: 'application/pdf', buffer: uniquePdf() });
    await page.getByText(pdfName).first().click();
    await expect(page).toHaveURL(/\/admin\/media\/[a-z0-9]+$/);
    await page.getByRole('button', { name: 'APPROVE' }).click();
    await expect(page.getByText('Approved').first()).toBeVisible();

    // Reuse the always-seeded "qa-mastery" project (see prisma/seed-content.ts) rather than
    // creating and deleting a throwaway one through the UI form — this suite already shares a
    // tight, documented app-wide rate limit (60 req/60s/IP, see playwright.config.ts) across the
    // whole run, and a create+delete round trip through the UI costs several more requests than
    // this test's actual subject (what the evidence dropdown offers) needs.
    await page.goto('/admin/projects');
    await page.getByRole('row', { name: /qa-mastery/i }).getByRole('link', { name: 'EDIT' }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/[a-z0-9]+$/);

    // The "Approved image" select is populated from GET /admin/media?status=approved&category=image
    // — an approved PDF is APPROVED but not category=image, so it must never appear as an option,
    // while the approved image must.
    const evidenceSelect = page.getByLabel('Approved image');
    await expect(evidenceSelect.locator('option', { hasText: imageName })).toHaveCount(1);
    await expect(evidenceSelect.locator('option', { hasText: pdfName })).toHaveCount(0);
  });
});
