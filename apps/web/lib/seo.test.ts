// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('seo — getSiteUrl / absoluteUrl', () => {
  const originalUrl = process.env.PUBLIC_SITE_URL;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = originalUrl;
    vi.stubEnv('NODE_ENV', originalEnv ?? 'test');
  });

  it('strips a trailing slash from a configured PUBLIC_SITE_URL', async () => {
    process.env.PUBLIC_SITE_URL = 'https://example.com/';
    const { getSiteUrl } = await import('./seo');
    expect(getSiteUrl()).toBe('https://example.com');
  });

  it('falls back to localhost when unset outside production', async () => {
    delete process.env.PUBLIC_SITE_URL;
    vi.stubEnv('NODE_ENV', 'test');
    const { getSiteUrl } = await import('./seo');
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });

  it('fails closed when unset in production', async () => {
    delete process.env.PUBLIC_SITE_URL;
    vi.stubEnv('NODE_ENV', 'production');
    const { getSiteUrl } = await import('./seo');
    expect(() => getSiteUrl()).toThrow(/PUBLIC_SITE_URL/);
  });

  it('builds an absolute URL from a relative path', async () => {
    process.env.PUBLIC_SITE_URL = 'https://example.com';
    const { absoluteUrl } = await import('./seo');
    expect(absoluteUrl('/work/qa-mastery')).toBe('https://example.com/work/qa-mastery');
    expect(absoluteUrl('work/qa-mastery')).toBe('https://example.com/work/qa-mastery');
  });
});

describe('seo — JSON-LD builders', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PUBLIC_SITE_URL = 'https://example.com';
  });

  it('builds Person JSON-LD from the public profile subset', async () => {
    const { personJsonLd } = await import('./seo');
    expect(personJsonLd({ name: 'Sagar Thapa', headline: 'QA Engineer', bio: 'Bio.' })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Sagar Thapa',
      jobTitle: 'QA Engineer',
      description: 'Bio.',
      url: 'https://example.com',
    });
  });

  it('builds CreativeWork JSON-LD for a project', async () => {
    const { creativeWorkJsonLd } = await import('./seo');
    expect(
      creativeWorkJsonLd({ title: 'QA Mastery', summary: 'A platform.', slug: 'qa-mastery' }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: 'QA Mastery',
      description: 'A platform.',
      url: 'https://example.com/work/qa-mastery',
    });
  });

  it('builds Article JSON-LD for a Field Note, omitting datePublished when unset', async () => {
    const { articleJsonLd } = await import('./seo');
    expect(
      articleJsonLd({
        title: 'Testing in Production',
        excerpt: 'Notes.',
        slug: 'testing-in-production',
        publishedAt: null,
        author: 'Sagar Thapa',
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Testing in Production',
      description: 'Notes.',
      url: 'https://example.com/notes/testing-in-production',
      author: { '@type': 'Person', name: 'Sagar Thapa' },
    });
  });
});
