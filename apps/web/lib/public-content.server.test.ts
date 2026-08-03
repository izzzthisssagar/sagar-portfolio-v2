// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('public-content.server — ALLOW_STATIC_CONTENT_FALLBACK boundary', () => {
  const originalFlag = process.env.ALLOW_STATIC_CONTENT_FALLBACK;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.ALLOW_STATIC_CONTENT_FALLBACK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalFlag === undefined) delete process.env.ALLOW_STATIC_CONTENT_FALLBACK;
    else process.env.ALLOW_STATIC_CONTENT_FALLBACK = originalFlag;
  });

  it('defaults to false and fails visibly (throws) instead of serving static fallback when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const { getPublishedProjects, getPublishedProjectBySlug } = await import(
      './public-content.server'
    );
    await expect(getPublishedProjects()).rejects.toThrow(/refusing to silently substitute/i);
    await expect(getPublishedProjectBySlug('qa-mastery')).rejects.toThrow(
      /refusing to silently substitute/i,
    );
  });

  it('stays false even when NODE_ENV is not "production" (no implicit dev fallback)', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { getPublishedProjects } = await import('./public-content.server');
    await expect(getPublishedProjects()).rejects.toThrow(/refusing to silently substitute/i);
    vi.stubEnv('NODE_ENV', previousNodeEnv ?? 'test');
  });

  it('serves the labelled static fallback only once explicitly enabled', async () => {
    process.env.ALLOW_STATIC_CONTENT_FALLBACK = 'true';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { getPublishedProjects, getPublishedProjectBySlug } = await import(
      './public-content.server'
    );
    const projects = await getPublishedProjects();
    expect(Array.isArray(projects)).toBe(true);
    const project = await getPublishedProjectBySlug('qa-mastery');
    expect(project === null || project.slug === 'qa-mastery').toBe(true);
  });

  it('treats a real 404 as "not found", not "unavailable" — never throws and never falls back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { getPublishedProjectBySlug } = await import('./public-content.server');
    await expect(getPublishedProjectBySlug('does-not-exist')).resolves.toBeNull();
  });

  it('returns real database-backed content when the API responds, regardless of the flag', async () => {
    const record = {
      id: 'p1',
      slug: 'qa-mastery',
      title: 'QA Mastery',
      summary: 'Summary',
      status: 'published',
      sceneState: 'mastery',
      metrics: [],
      findings: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: record }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { getPublishedProjectBySlug } = await import('./public-content.server');
    const project = await getPublishedProjectBySlug('qa-mastery');
    expect(project).toEqual(record);
  });

  it('posts: fails visibly (throws) instead of serving static fallback when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const { getPublishedPosts, getPublishedPostBySlug } = await import('./public-content.server');
    await expect(getPublishedPosts()).rejects.toThrow(/refusing to silently substitute/i);
    await expect(getPublishedPostBySlug('reading-p95-p99')).rejects.toThrow(
      /refusing to silently substitute/i,
    );
  });

  it('posts: treats a real 404 as "not found", never throws and never falls back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { getPublishedPostBySlug } = await import('./public-content.server');
    await expect(getPublishedPostBySlug('does-not-exist')).resolves.toBeNull();
  });

  it('posts: returns real database-backed content when the API responds', async () => {
    const record = {
      id: 'post1',
      title: 'Reading P95 and P99 without guessing',
      slug: 'reading-p95-p99',
      excerpt: 'An excerpt.',
      body: 'Body content.',
      status: 'published',
      publishedAt: '2026-01-01T00:00:00.000Z',
      readingTime: 3,
      tags: ['performance'],
      seoTitle: 'Reading P95 and P99 without guessing',
      seoDescription: 'An excerpt.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: record }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const { getPublishedPostBySlug } = await import('./public-content.server');
    const post = await getPublishedPostBySlug('reading-p95-p99');
    expect(post).toEqual(record);
  });

  it('posts: serves the labelled static fallback only once explicitly enabled', async () => {
    process.env.ALLOW_STATIC_CONTENT_FALLBACK = 'true';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { getPublishedPosts } = await import('./public-content.server');
    const posts = await getPublishedPosts();
    expect(Array.isArray(posts)).toBe(true);
  });
});
