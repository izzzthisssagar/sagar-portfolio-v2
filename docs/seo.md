# SEO and structured data

Status: **implemented** — per-page metadata (title/description/canonical/Open Graph/Twitter cards),
`Person`/`WebSite`/`CreativeWork`/`Article` JSON-LD, `sitemap.xml`, `robots.txt`, `/admin/*`
`noindex,nofollow`, and the public media delivery hardening below are all live.

## Ownership

Canonical URLs and metadata are generated from stored content plus one required environment
variable, `PUBLIC_SITE_URL` — never hardcoded or guessed from request headers. Production startup
fails closed if `PUBLIC_SITE_URL` is unset (same fail-closed pattern as the media/contact adapters).

| Page | Title/description source | Structured data |
|---|---|---|
| Homepage / About | `Profile` row (public `GET /profile`, excludes `email`) | `Person`, `WebSite` |
| Work index | static copy | — |
| Project page | derived from `Project.title`/`summary` (no `seoTitle` field was added — nothing in the stored record needed one beyond the title itself) | `CreativeWork` |
| Notes index | static copy | — |
| Field Note page | `BlogPost.seoTitle`, `seoDescription`, `canonicalUrl` | `Article` |
| Contact | static copy | — |

Only factual, already-stored content feeds metadata and structured data — no invented ratings,
employers, awards, or credentials. Draft/review/archived content is excluded from `sitemap.xml`
(the sitemap generator queries `status = PUBLISHED` only, same predicate as the public content
endpoints). Preview routes (`/admin/posts/:id/preview` and any future `?preview=` public-preview
mode) and every `/admin/*` CMS page render `noindex, nofollow` via `robots` metadata.

## Sitemap and robots

`GET /sitemap.xml` (`apps/web/app/sitemap.ts`) and `GET /robots.txt` (`apps/web/app/robots.ts`) are
Next.js route handlers, not static files — the sitemap queries published projects and posts through
the same `revalidate: 60` fetch used by every other public page, so newly published content appears
within a minute without a redeploy, never at build time. `robots.txt` disallows `/admin` and points
at `PUBLIC_SITE_URL/sitemap.xml`.

## Public media delivery hardening (Phase 18)

`GET /media/:id/file` (`PublicMediaController`) is cached as immutable:
`Cache-Control: public, max-age=31536000, immutable`, with an `ETag` set to the asset's own SHA-256.
This is safe because storage keys are content-addressed (see `docs/media-pipeline.md`) — a given
media `id` always resolves to the same bytes for its lifetime, so there is nothing to revalidate.
A conditional request (`If-None-Match` matching the current ETag) short-circuits to `304` without
re-streaming the file. Still 404s for anything not `APPROVED`, without distinguishing why, exactly
as before.

## Configuration

```
PUBLIC_SITE_URL=https://example.com
```
