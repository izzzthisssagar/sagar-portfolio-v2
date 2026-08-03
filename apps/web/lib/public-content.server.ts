import 'server-only';
import type { PostRecord, ProjectDetailRecord, ProjectRecord } from '@portfolio/types';
import { notes as fallbackNotes, projects as fallbackProjects } from './content';

const API_URL = process.env.API_URL
  ? `${process.env.API_URL}/api/v1`
  : 'http://localhost:4000/api/v1';

/**
 * Explicit opt-in only — never inferred from `NODE_ENV`. A developer can set
 * this locally to keep working with static seed content while the API is
 * down; CI, preview, staging, and production must never enable it, and this
 * defaults to false so simply forgetting to set it is the safe outcome.
 */
function staticFallbackAllowed(): boolean {
  return process.env.ALLOW_STATIC_CONTENT_FALLBACK === 'true';
}

class PublicContentUnavailableError extends Error {
  constructor(what: string) {
    super(
      `[public-content] ${what} and ALLOW_STATIC_CONTENT_FALLBACK is not "true" — ` +
        'refusing to silently substitute static fallback content.',
    );
    this.name = 'PublicContentUnavailableError';
  }
}

type FetchOutcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/** A 404 means "this content genuinely doesn't exist" — a real, legitimate
 * answer from a reachable API, not an outage. Only network failures and
 * non-404 error responses count as "unavailable" and are eligible for the
 * fallback/fail-visibly decision below. */
async function publicFetch<T>(path: string): Promise<FetchOutcome<T>> {
  try {
    const response = await fetch(`${API_URL}${path}`, { next: { revalidate: 60 } });
    if (response.status === 404) return { status: 'not_found' };
    if (!response.ok) return { status: 'unavailable' };
    const payload = await response.json();
    return { status: 'ok', data: (payload.data ?? payload) as T };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Database-backed published project content. When the API is unreachable,
 * this either serves the labelled static seed (only when a developer has
 * explicitly set `ALLOW_STATIC_CONTENT_FALLBACK=true`) or fails visibly —
 * it never silently substitutes fake content for a real outage.
 */
export async function getPublishedProjects(): Promise<ProjectRecord[]> {
  const result = await publicFetch<ProjectRecord[]>('/projects?limit=100&sort=order&direction=asc');
  if (result.status === 'ok') return result.data;
  if (result.status === 'not_found') return [];
  if (staticFallbackAllowed()) {
    console.warn('[public-content] API unavailable — using local development fallback content.');
    return fallbackProjects.filter((project) => project.status === 'published');
  }
  throw new PublicContentUnavailableError('the project list API request failed');
}

/** The legacy static seed (`lib/content.ts`) is `ArticleRecord`-shaped, not `PostRecord`-shaped —
 * adapt it for the (currently always-empty, since none of the static articles are `published`)
 * fallback path so the function signature stays honest about what it returns. */
function toPostRecord(article: (typeof fallbackNotes)[number]): PostRecord {
  return {
    id: article.slug,
    title: article.title,
    slug: article.slug,
    excerpt: article.excerpt,
    body: article.body,
    status: article.status,
    publishedAt: article.publishedDate ?? null,
    readingTime: article.readingTime,
    tags: article.tags,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
  };
}

export async function getPublishedPosts(): Promise<PostRecord[]> {
  const result = await publicFetch<PostRecord[]>('/posts?limit=100');
  if (result.status === 'ok') return result.data;
  if (result.status === 'not_found') return [];
  if (staticFallbackAllowed()) {
    console.warn('[public-content] API unavailable — using local development fallback content.');
    return fallbackNotes.filter((note) => note.status === 'published').map(toPostRecord);
  }
  throw new PublicContentUnavailableError('the post list API request failed');
}

export async function getPublishedPostBySlug(slug: string): Promise<PostRecord | null> {
  const result = await publicFetch<PostRecord>(`/posts/${slug}`);
  if (result.status === 'ok') return result.data;
  if (result.status === 'not_found') return null;
  if (staticFallbackAllowed()) {
    const fallback = fallbackNotes.find(
      (note) => note.slug === slug && note.status === 'published',
    );
    if (fallback) {
      console.warn(
        `[public-content] API unavailable — using local development fallback for "${slug}".`,
      );
      return toPostRecord(fallback);
    }
    return null;
  }
  throw new PublicContentUnavailableError(`the post API request for "${slug}" failed`);
}

export async function getPublishedProjectBySlug(slug: string): Promise<ProjectDetailRecord | null> {
  const result = await publicFetch<ProjectDetailRecord>(`/projects/${slug}`);
  if (result.status === 'ok') return result.data;
  if (result.status === 'not_found') return null;
  if (staticFallbackAllowed()) {
    const fallback = fallbackProjects.find(
      (project) => project.slug === slug && project.status === 'published',
    );
    if (fallback) {
      console.warn(
        `[public-content] API unavailable — using local development fallback for "${slug}".`,
      );
      return { ...fallback, findings: [] };
    }
    return null;
  }
  throw new PublicContentUnavailableError(`the project API request for "${slug}" failed`);
}
