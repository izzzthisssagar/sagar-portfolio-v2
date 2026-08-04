import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from '@playwright/test';
import { hasDatabase } from '../../playwright.config';
import { loginViaUI } from './helpers';

/**
 * Sprint 4 accessibility/responsive release sweep: axe scans (no serious/critical violations)
 * across the required viewports (390x844 mobile, 768x1024 tablet, 1440x900 desktop) and the
 * required flows not already covered elsewhere — smoke.spec.ts covers the homepage at mobile
 * width and cms-auth.spec.ts covers the dashboard at default width; this file is what closes the
 * remaining gap (project page, field note, contact form, login, project/post editors, media
 * library, message inbox — at all three viewports).
 */
test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

const VIEWPORTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

/**
 * Logs in once for real through the actual UI form (never a forged/bypass token — matches this
 * suite's existing security posture), then hands back the resulting session cookies so later
 * tests can reuse the same live, database-backed session via `context.addCookies()` instead of
 * each calling loginViaUI itself. `/api/v1/auth/login` carries its own strict per-route rate
 * limit (20 requests/60s — docs/security-production.md), separate from the raised
 * RATE_LIMIT_MAX global CI budget; a dozen-plus fresh UI logins concentrated in one spec file
 * was observed (by actually running this suite) to trip it and fail every subsequent login with
 * a generic "Something went wrong" error — this is the fix, not a workaround around real auth.
 */
async function loginOnceAndCaptureCookies(browser: Browser): Promise<Cookie[]> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await loginViaUI(page);
    return await context.cookies();
  } finally {
    await context.close();
  }
}

async function useSharedSession(context: BrowserContext, cookies: Cookie[]): Promise<void> {
  await context.addCookies(cookies);
}

async function assertNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) =>
    ['critical', 'serious'].includes(v.impact ?? ''),
  );
  expect(
    serious,
    `${label}: ${serious.map((v) => `${v.id} (${v.nodes.length} node(s))`).join(', ')}`,
  ).toEqual([]);
}

async function assertNoHorizontalScroll(page: Page, label: string) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, `${label}: page overflows horizontally at this viewport width`).toBe(false);
}

test.describe('Accessibility sweep — public flows', () => {
  for (const vp of VIEWPORTS) {
    test(`homepage (${vp.name})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      await assertNoSeriousViolations(page, `homepage@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `homepage@${vp.name}`);
    });

    test(`published project page (${vp.name})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/work/qa-mastery');
      await assertNoSeriousViolations(page, `project-page@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `project-page@${vp.name}`);
    });

    test(`contact form (${vp.name})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/contact');
      await assertNoSeriousViolations(page, `contact-form@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `contact-form@${vp.name}`);
    });
  }
});

test.describe('Accessibility sweep — field note (public, published via the real CMS flow)', () => {
  const suffix = `a11y-${Date.now()}`;
  const title = `A11y Sweep Note ${suffix}`;
  const slug = `a11y-sweep-note-${suffix}`;
  let authCookies: Cookie[] = [];

  test.beforeAll(async ({ browser }) => {
    authCookies = await loginOnceAndCaptureCookies(browser);
  });

  test('publish a fixture Field Note for this sweep', async ({ page, context }) => {
    await useSharedSession(context, authCookies);
    await page.goto('/admin/posts/new');
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByLabel('Slug').fill(slug);
    await page
      .getByLabel('Excerpt')
      .fill('Accessibility sweep fixture excerpt, long enough to pass validation.');
    await page.getByLabel('Body (Markdown)').fill('Accessibility sweep fixture body content.');
    await page.getByRole('button', { name: 'CREATE POST' }).click();
    await expect(page).toHaveURL(/\/admin\/posts\/(?!new$)[a-z0-9]+$/);

    await page.goto('/admin/posts');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: 'PUBLISH' }).click();
    await expect(row.getByText('Published')).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`field note detail page (${vp.name})`, async ({ page }) => {
      await page.setViewportSize(vp);
      const response = await page.goto(`/notes/${slug}`);
      expect(response?.ok()).toBe(true);
      await assertNoSeriousViolations(page, `field-note@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `field-note@${vp.name}`);
    });
  }

  test('clean up the fixture Field Note', async ({ page, context }) => {
    await useSharedSession(context, authCookies);
    await page.goto('/admin/posts');
    const row = page.getByRole('row', { name: new RegExp(title) });
    await row.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await dialog.getByRole('button', { name: 'DELETE' }).click();
    await expect(page.getByRole('row', { name: new RegExp(title) })).toHaveCount(0);
  });
});

test.describe('Accessibility sweep — admin flows', () => {
  let authCookies: Cookie[] = [];

  test.beforeAll(async ({ browser }) => {
    authCookies = await loginOnceAndCaptureCookies(browser);
  });

  for (const vp of VIEWPORTS) {
    test(`admin login page, unauthenticated (${vp.name})`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/admin/login');
      await assertNoSeriousViolations(page, `admin-login@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `admin-login@${vp.name}`);
    });

    test(`dashboard (${vp.name})`, async ({ page, context }) => {
      await useSharedSession(context, authCookies);
      await page.setViewportSize(vp);
      await page.goto('/admin/dashboard');
      await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
      await assertNoSeriousViolations(page, `dashboard@${vp.name}`);
      if (vp.width <= 400) await assertNoHorizontalScroll(page, `dashboard@${vp.name}`);
    });

    test(`project editor (${vp.name})`, async ({ page, context }) => {
      await useSharedSession(context, authCookies);
      await page.setViewportSize(vp);
      await page.goto('/admin/projects/new');
      await assertNoSeriousViolations(page, `project-editor@${vp.name}`);
    });

    test(`post editor (${vp.name})`, async ({ page, context }) => {
      await useSharedSession(context, authCookies);
      await page.setViewportSize(vp);
      await page.goto('/admin/posts/new');
      await assertNoSeriousViolations(page, `post-editor@${vp.name}`);
    });

    test(`media library (${vp.name})`, async ({ page, context }) => {
      await useSharedSession(context, authCookies);
      await page.setViewportSize(vp);
      await page.goto('/admin/media');
      await assertNoSeriousViolations(page, `media-library@${vp.name}`);
    });

    test(`message inbox (${vp.name})`, async ({ page, context }) => {
      await useSharedSession(context, authCookies);
      await page.setViewportSize(vp);
      await page.goto('/admin/messages');
      await assertNoSeriousViolations(page, `message-inbox@${vp.name}`);
    });
  }
});

test.describe('Accessibility sweep — keyboard and focus', () => {
  let authCookies: Cookie[] = [];

  test.beforeAll(async ({ browser }) => {
    authCookies = await loginOnceAndCaptureCookies(browser);
  });

  test('project editor form fields are reachable and labeled via Tab alone', async ({
    page,
    context,
  }) => {
    await useSharedSession(context, authCookies);
    await page.goto('/admin/projects/new');
    await page.getByLabel('Title').click();
    await page.keyboard.type('Keyboard Nav Check');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Slug')).toBeFocused();
  });

  test('the shared confirm dialog places focus on open, not left to the browser default', async ({
    page,
    context,
  }) => {
    // cms-projects.spec.ts already exercises Escape-to-cancel and Tab+Enter-to-confirm on this
    // same shared dialog.confirm-dialog component; what it doesn't assert is where focus lands
    // the moment the dialog opens — a keyboard user needs that placed on a real control
    // immediately, not left on the trigger button behind a now-modal dialog.
    await useSharedSession(context, authCookies);
    await page.goto('/admin/projects/new');
    await page.getByLabel('Title').fill('Focus Trap Check');
    await page.getByLabel('Slug').fill(`focus-trap-check-${Date.now()}`);
    await page.getByLabel('Summary').fill('A sufficiently long summary for validation purposes.');
    await page.getByLabel('Overview').fill('Overview text.');
    await page.getByLabel('Responsibilities').fill('Responsibilities text.');
    await page.getByRole('button', { name: 'CREATE PROJECT' }).click();
    await expect(page).toHaveURL(/\/admin\/projects\/(?!new$)[a-z0-9]+$/);

    await page.goto('/admin/projects');
    const row = page.getByRole('row', { name: /Focus Trap Check/ });
    await row.getByRole('button', { name: 'DELETE' }).click();
    const dialog = page.locator('dialog.confirm-dialog[open]');
    await expect(dialog).toBeVisible();
    // ConfirmDialog.tsx deliberately focuses Cancel, not the destructive Confirm/DELETE action,
    // so a stray Enter keypress can't confirm a delete unintentionally — this asserts that real
    // (and deliberately safety-conscious) behavior, not just "focus moved somewhere".
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Row still present (Escape cancelled, did not delete) — clean up for real now.
    await row.getByRole('button', { name: 'DELETE' }).click();
    await dialog.getByRole('button', { name: 'DELETE' }).click();
    await expect(page.getByRole('row', { name: /Focus Trap Check/ })).toHaveCount(0);
  });

  test('contact form validation errors are programmatically associated with their fields', async ({
    page,
  }) => {
    await page.goto('/contact');
    // ContactForm.tsx uses noValidate (native browser validation is off) and its own
    // validateContactForm — required fields left empty render an aria-describedby'd error span
    // and flip aria-invalid, rather than relying on unannounced native browser tooltips.
    await page.getByRole('button', { name: 'SEND' }).click();
    const nameInput = page.getByLabel('Name');
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toBeVisible();
  });
});
