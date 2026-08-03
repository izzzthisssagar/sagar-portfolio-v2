import { expect, test } from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

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

    const pdfName = `e2e-evidence-doc-${Date.now()}.pdf`;

    // Upload and approve a PDF document — the media pipeline approves it fine (a PDF is a
    // perfectly valid document asset), but the evidence gallery's own filter must still exclude
    // it. Only the PDF leg is exercised here — the "an approved image IS offered" half of the
    // contract is already covered by every other e2e spec that attaches evidence via this same
    // dropdown, and this suite shares a tight, documented app-wide rate limit (60 req/60s/IP, see
    // playwright.config.ts) across its whole run, so this test carries only the request volume
    // its own subject actually requires.
    await page.goto('/admin/media');
    await page
      .getByLabel('Upload image or PDF (drag and drop, or choose a file)')
      .setInputFiles({ name: pdfName, mimeType: 'application/pdf', buffer: uniquePdf() });
    await page.getByText(pdfName).first().click();
    await expect(page).toHaveURL(/\/admin\/media\/[a-z0-9]+$/);
    await page.getByRole('button', { name: 'APPROVE' }).click();
    await expect(page.getByText('Approved').first()).toBeVisible();

    // Reuse the always-seeded "qa-mastery" project (see prisma/seed-content.ts) rather than
    // creating and deleting a throwaway one through the UI form — same rate-limit-budget reason.
    await page.goto('/admin/projects');
    await page
      .getByRole('row', { name: /qa-mastery/i })
      .getByRole('link', { name: 'EDIT' })
      .click();
    await expect(page).toHaveURL(/\/admin\/projects\/[a-z0-9]+$/);

    // The "Approved image" select is populated from GET /admin/media?status=approved&category=image
    // — an approved PDF is APPROVED but not category=image, so it must never appear as an option.
    const evidenceSelect = page.getByLabel('Approved image');
    await expect(evidenceSelect.locator('option', { hasText: pdfName })).toHaveCount(0);
  });
});
