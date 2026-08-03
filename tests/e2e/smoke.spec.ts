import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SignJWT } from 'jose';
import { hasDatabase, jwtTestConfig } from '../../playwright.config';

const publicRoutes = [
  '/',
  '/work',
  '/notes',
  '/notes/testing-otp-beyond-happy-path',
  '/about',
  '/contact',
  '/lab/qa-rift',
  '/admin/login',
];
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
});

test('valid administrator JWT permits the CMS shell', async ({ context, page }) => {
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('playwright-admin')
    .setIssuer(jwtTestConfig.accessIssuer)
    .setAudience(jwtTestConfig.accessAudience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(jwtTestConfig.accessSecret));
  await context.addCookies([
    { name: 'portfolio_access', value: token, domain: '127.0.0.1', path: '/', httpOnly: true },
  ]);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
});
