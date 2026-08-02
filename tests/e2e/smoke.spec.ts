import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SignJWT } from 'jose';
import { jwtTestConfig } from '../../playwright.config';

const publicRoutes = [
  '/',
  '/work',
  '/work/qa-mastery',
  '/work/numazu-halal-food',
  '/work/api-security-testing',
  '/work/performance-testing',
  '/work/automation-testing',
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
