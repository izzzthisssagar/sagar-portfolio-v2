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

/** Renders a JSON-LD `<script>` tag. Server-only — call from a Server Component. */
export function JsonLd({ data }: { data: object }) {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
