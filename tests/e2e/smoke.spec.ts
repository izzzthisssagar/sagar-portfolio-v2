import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { hasDatabase } from '../../playwright.config';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './test-admin';

const publicRoutes = ['/', '/work', '/notes', '/about', '/contact', '/lab/qa-rift', '/admin/login'];
test('all public routes return successfully', async ({ page }) => {
  for (const route of publicRoutes) {
    const response = await page.goto(route);
    expect(response?.ok(), route).toBe(true);
  }
});
test('homepage navigation and serious axe gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /turn assumptions/i })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});
test('sitemap.xml lists published content and robots.txt disallows /admin', async ({
  page,
  request,
}) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain('<loc>http://127.0.0.1:3000/work/qa-mastery</loc>');
  // Numazu Halal Food is seeded DRAFT (docs/sprint-3.md) — draft content must
  // never appear in the sitemap, which is generated from the published-only
  // public content endpoints (apps/web/app/sitemap.ts), not a raw table scan.
  expect(sitemapBody).not.toContain('numazu-halal-food');

  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  const robotsBody = await robots.text();
  expect(robotsBody).toContain('Disallow: /admin');
  expect(robotsBody).toContain('Sitemap:');

  await page.goto('/admin/login');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
test('security headers are present and the JSON-LD nonce matches the CSP header', async ({
  request,
}) => {
  // A raw request, not page.goto() — React deliberately strips the `nonce` attribute from
  // `<script>` elements in the live DOM after hydration (so an XSS payload can't read it back
  // out via document.querySelectorAll), so this has to inspect the actual server-rendered HTML.
  const response = await request.get('/');
  const headers = response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['permissions-policy']).toContain('camera=()');

  const csp = headers['content-security-policy'];
  expect(csp).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain('unsafe-inline');
  // 'unsafe-eval' is intentionally present outside production only — React's dev-mode debugging
  // uses eval() for component stack traces (never in production; see security-headers.ts). This
  // suite runs against the dev server, so it's expected here, not something to assert against.
  expect(csp).not.toMatch(/-src[^;]*\*/); // no wildcard source

  const nonceMatch = csp.match(/'nonce-([a-f0-9]+)'/);
  expect(nonceMatch).toBeTruthy();
  const html = await response.text();
  expect(html).toContain(`application/ld+json" nonce="${nonceMatch![1]}"`);
});
test('mobile navigation is keyboard and touch operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'MENU' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'WORK', exact: true }).click();
  await expect(page).toHaveURL(/\/work$/);
});
test('unauthenticated admin routes redirect without exposing CMS navigation', async ({ page }) => {
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
});
test('invalid admin cookie redirects and never renders CMS navigation', async ({
  context,
  page,
}) => {
  await context.addCookies([
    {
      name: 'portfolio_access',
      value: 'arbitrary-cookie',
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
    },
  ]);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0);
});
test('QA Mastery is served from the seeded PostgreSQL record, not static fallback content', async ({
  page,
  request,
}) => {
  test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + seeded content');

  const apiResponse = await request.get('http://127.0.0.1:4000/api/v1/projects/qa-mastery');
  expect(apiResponse.ok()).toBe(true);
  const { data } = await apiResponse.json();
  // The static dev-fallback shape (apps/web/lib/content.ts) uses a fixed
  // id ('01') and has no liveUrl/githubUrl at all — only the real,
  // database-backed record has a generated cuid id and these fields.
  expect(data.id).not.toBe('01');
  expect(data.id).toMatch(/^[a-z0-9]{20,}$/i);
  expect(data.liveUrl).toBe('https://qa-mastery-platform.vercel.app/');
  expect(data.githubUrl).toBe('https://github.com/izzzthisssagar/qa-mastery');

  const pageResponse = await page.goto('/work/qa-mastery');
  expect(pageResponse?.ok()).toBe(true);
  await expect(page.getByRole('heading', { name: 'QA Mastery' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'VIEW LIVE' })).toHaveAttribute(
    'href',
    'https://qa-mastery-platform.vercel.app/',
  );
  const ldJson = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(ldJson ?? '{}')).toMatchObject({ '@type': 'CreativeWork', name: 'QA Mastery' });
});

test('a live, database-backed session permits the CMS shell — a well-formed JWT alone is not enough', async ({
  context,
  page,
}) => {
  test.skip(!hasDatabase, 'requires DATABASE_URL for the live API + a provisioned admin account');

  // A forged-but-well-formed JWT for a `sub` with no real AdminUser row
  // used to be sufficient here, because the proxy's edge check never
  // touches the database. It no longer is: the CMS layout now calls the
  // live /auth/session endpoint, which JwtAuthGuard rejects for any
  // subject that doesn't resolve to a real, current-tokenVersion admin —
  // so this test authenticates for real, through the API, against the
  // browser context's shared cookie jar (`context.request` shares cookies
  // with `page`), and checks the resulting session is honored end to end.
  const loginResponse = await context.request.post('http://127.0.0.1:4000/api/v1/auth/login', {
    headers: { origin: 'http://127.0.0.1:3000' },
    data: { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD },
  });
  expect(loginResponse.ok()).toBe(true);

  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
});
