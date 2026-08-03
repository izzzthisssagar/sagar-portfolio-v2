// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const HOSTILE = '</script><script>window.injected=true</script>';

/** Extracts the JSON-LD payload from the single `<script type="application/ld+json">` tag in a
 * server-rendered HTML string — fails the test (via a thrown error, not a silent empty match) if
 * there isn't exactly one. */
function extractJsonLdPayload(html: string): string {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one JSON-LD script tag, found ${matches.length} in: ${html}`);
  }
  return matches[0]![1]!;
}

describe('JsonLd — safe serialization', () => {
  it('escapes a </script><script> breakout attempt so no second script tag is created', async () => {
    process.env.PUBLIC_SITE_URL = 'https://example.com';
    const { JsonLd, personJsonLd } = await import('./seo');
    const data = personJsonLd({ name: HOSTILE, headline: 'QA Engineer', bio: 'Bio.' });
    const html = renderToStaticMarkup(<JsonLd data={data} />);

    // The literal hostile byte sequence — as markup, not as inert JSON string data — must never
    // appear: no real `</script>` or `<script>` tag boundary in the rendered HTML.
    expect(html).not.toContain(HOSTILE);
    expect(html).not.toContain('</script><script>');
    // Exactly one <script tag exists — no second element was injected. (The literal text
    // "window.injected" still appears, harmlessly, as an escaped JSON string value — the property
    // under test is that it's inert data, not that the substring is absent.)
    expect(html.match(/<script/g)).toHaveLength(1);

    // The payload is still valid, round-trippable JSON carrying the original (unescaped) value.
    const payload = extractJsonLdPayload(html);
    const parsed = JSON.parse(payload);
    expect(parsed.name).toBe(HOSTILE);
    expect(parsed['@type']).toBe('Person');
  });

  it('escapes U+2028 and U+2029 without corrupting the JSON payload', async () => {
    process.env.PUBLIC_SITE_URL = 'https://example.com';
    const { JsonLd, personJsonLd } = await import('./seo');
    const withSeparators = `Line one\u2028line two\u2029line three`;
    const data = personJsonLd({
      name: 'Sagar Thapa',
      headline: 'QA Engineer',
      bio: withSeparators,
    });
    const html = renderToStaticMarkup(<JsonLd data={data} />);

    expect(html).not.toContain('\u2028');
    expect(html).not.toContain('\u2029');
    const parsed = JSON.parse(extractJsonLdPayload(html));
    // personJsonLd maps the `bio` input onto the JSON-LD `description` field.
    expect(parsed.description).toBe(withSeparators);
  });

  it('still renders valid Person, WebSite, CreativeWork, and Article JSON-LD', async () => {
    process.env.PUBLIC_SITE_URL = 'https://example.com';
    const { JsonLd, personJsonLd, websiteJsonLd, creativeWorkJsonLd, articleJsonLd } = await import(
      './seo'
    );

    const cases = [
      personJsonLd({ name: 'Sagar Thapa', headline: 'QA Engineer', bio: 'Bio.' }),
      websiteJsonLd(),
      creativeWorkJsonLd({ title: 'QA Mastery', summary: 'A platform.', slug: 'qa-mastery' }),
      articleJsonLd({
        title: 'Testing in Production',
        excerpt: 'Notes.',
        slug: 'testing-in-production',
        publishedAt: null,
        author: 'Sagar Thapa',
      }),
    ];

    for (const data of cases) {
      const html = renderToStaticMarkup(<JsonLd data={data} />);
      const parsed = JSON.parse(extractJsonLdPayload(html));
      expect(parsed['@context']).toBe('https://schema.org');
      expect(parsed['@type']).toBe(data['@type']);
    }
  });
});
