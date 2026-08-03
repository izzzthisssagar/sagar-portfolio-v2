# SEO and structured data

Status: **design-only** as of this doc's last update — not yet implemented for Sprint 3's expanded
scope (homepage/About/Work/Notes/Contact metadata, sitemap, JSON-LD). Update once the vertical
lands.

## Ownership

Canonical URLs and metadata are generated from stored content plus one required environment
variable, `PUBLIC_SITE_URL` — never hardcoded or guessed from request headers. Production startup
fails closed if `PUBLIC_SITE_URL` is unset (same fail-closed pattern as the media/contact adapters).

| Page | Title/description source | Structured data |
|---|---|---|
| Homepage / About | `Profile` row | `Person`, `WebSite` |
| Work index | static copy | — |
| Project page | `Project.title/summary/seoTitle?` fields once added, else derived from `title`/`summary` | `CreativeWork` (or `SoftwareApplication` only where factually applicable — never asserted without a factual basis in the stored project record) |
| Notes index | static copy | — |
| Field Note page | `BlogPost.seoTitle`, `seoDescription`, `canonicalUrl` | `Article` |
| Contact | static copy | — |

Only factual, already-stored content feeds metadata and structured data — no invented ratings,
employers, awards, or credentials. Draft/review/archived content is excluded from `sitemap.xml`
(the sitemap generator queries `status = PUBLISHED` only, same predicate as the public content
endpoints). Preview routes (`/admin/posts/:id/preview` and any future `?preview=` public-preview
mode) and every `/admin/*` CMS page render `noindex, nofollow` via `robots` metadata.

## Sitemap and robots

`GET /sitemap.xml` — generated from the database at request time (not statically at build time),
so newly published content appears without a redeploy. `GET /robots.txt` — disallows `/admin`,
references `PUBLIC_SITE_URL/sitemap.xml`.

## Configuration

```
PUBLIC_SITE_URL=https://example.com
```
