import 'server-only';
import type { PostRecord, ProjectRecord } from '@portfolio/types';
import type { PublicProfile } from './public-content.server';

const SITE_NAME = 'Sagar Thapa / Quality Engineer';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Canonical public origin for absolute URLs (metadata, JSON-LD, sitemap.xml, robots.txt) — never
 * inferred from request headers. Production fails closed when unset (same pattern as the media
 * storage and contact notification adapters); development/test default to localhost so nothing
 * extra needs configuring locally. See docs/seo.md.
 */
export function getSiteUrl(): string {
  const configured = process.env.PUBLIC_SITE_URL;
  if (configured) return stripTrailingSlash(configured);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[seo] PUBLIC_SITE_URL is not set — refusing to build page metadata, sitemap, or robots ' +
        'output with a guessed origin in production.',
    );
  }
  return 'http://localhost:3000';
}

export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function personJsonLd(profile: PublicProfile) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.headline,
    description: profile.bio,
    url: getSiteUrl(),
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: getSiteUrl(),
  };
}

export function creativeWorkJsonLd(project: Pick<ProjectRecord, 'title' | 'summary' | 'slug'>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    description: project.summary,
    url: absoluteUrl(`/work/${project.slug}`),
  };
}

export function articleJsonLd(
  post: Pick<PostRecord, 'title' | 'excerpt' | 'slug' | 'publishedAt' | 'author'>,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    url: absoluteUrl(`/notes/${post.slug}`),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    author: { '@type': 'Person', name: post.author },
  };
}

/**
 * `JSON.stringify` never escapes `<`, so a raw value containing `</script>` (e.g. attacker input
 * echoed into a Person/Article JSON-LD field) would prematurely close the script element in the
 * server-rendered HTML and let an attacker-controlled `<script>` that follows execute. Escaping
 * `<` as `<` — a standard JSON escape sequence, valid inside a JSON string and restored to
 * `<` by any JSON.parse — closes that off without changing the decoded value. U+2028/U+2029
 * (line/paragraph separator) are escaped too: valid in JSON text but treated as line terminators
 * by some JS parsers, which has historically broken inline `<script>` bodies that assume a single
 * expression/statement.
 */
function safeJsonLdStringify(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Renders a JSON-LD `<script>` tag. Server-only — call from a Server Component. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(data) }}
    />
  );
}
