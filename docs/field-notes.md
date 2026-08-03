# Field Notes (`BlogPost`) content model

Status: **implemented** (schema, admin+public API, admin CMS, static-content migration).

## Model

`BlogPost` (`prisma/schema.prisma`) already existed with most of the required shape from Sprint 1;
Sprint 3 added `canonicalUrl` and `displayOrder`, and turned `featuredImageId`/`socialImageId` into
real (optional) relations to `MediaAsset` so the database enforces referential integrity instead of
trusting an unchecked string id.

| Field | Notes |
|---|---|
| `title`, `slug` (unique), `excerpt`, `body` | `body` is Markdown text, never raw HTML — see "Safe rendering" below. |
| `status` | `PublicationStatus`: `DRAFT`, `REVIEW`, `PUBLISHED`, `ARCHIVED`. |
| `tags` | Relational (`BlogTag`, many-to-many), kept from the pre-existing schema rather than flattened to a string array — lets tag pages/filtering reuse one canonical tag row instead of free text drifting across posts. |
| `featuredImageId` → `MediaAsset?` | Optional; enforced `APPROVED` at publish time (`publication-rules.ts`), not at the DB level (an admin may attach a still-`QUARANTINED` image while drafting). |
| `seoTitle`, `seoDescription`, `canonicalUrl` | SEO metadata fields (spec's `metaTitle`/`metaDescription` — kept the existing `seoTitle`/`seoDescription` names already used by the pre-existing schema and `docs/seo.md` conventions rather than introduce a synonym). |
| `publishedAt` | Set once, on the `publish` transition; untouched by later edits or by `draft`/`archive` transitions (an article's original publish date doesn't move if it's later revised or archived). |
| `displayOrder` | New; manual ordering for admin list / homepage teaser, mirrors `Project.order`. |

## Publication statuses and workflow

Same four-state model as `Project`: `draft → review → publish → archive`, plus `publish → draft`
(unpublish) and `archive → draft`. Transitions go exclusively through
`POST /api/v1/admin/posts/:id/workflow` — `status` is not a field on the create/update DTOs, so a
plain `PATCH` can never mint a published post or silently unpublish one. This mirrors
`ProjectsService`/`publication-rules.ts` exactly (`apps/api/src/projects/publication-rules.ts`).

Publish validation (`apps/api/src/posts/publication-rules.ts`) requires non-empty `title`, `slug`,
`excerpt`, and `body`, and — same invariant as projects — re-validates on every `PATCH` to a
published post, so an already-published article can't be edited into an invalid state without going
through `draft` first (`BlogPostsService.update`).

Deletion (`DELETE /api/v1/admin/posts/:id`) is a hard delete at the API layer; the admin UI requires
a confirmation dialog before calling it (same accessible confirm-dialog pattern as project deletion
in `tests/e2e/cms-projects.spec.ts`).

## Safe Markdown, not raw HTML

`body` is stored as Markdown source text. Two independent controls keep it safe:

1. **Write-time rejection of raw HTML** (`apps/api/src/posts/markdown-safety.ts`,
   `containsDisallowedMarkup`): the body is rejected (`400`) if it contains an HTML tag at all —
   Field Notes content is plain Markdown, not Markdown-with-HTML-escape-hatches. This also rejects
   the raw-HTML output of any browser-based rich-text editor, satisfying "do not store HTML
   produced directly by an untrusted browser editor" without needing to build or vet an HTML
   sanitizer allowlist.
2. **Read-time rendering through a sanitizing Markdown pipeline**
   (`apps/web/lib/markdown.ts`, shared by the public article page and the admin preview): Markdown
   → HTML via `marked` (link/heading/list/code formatting only — no raw-HTML passthrough,
   `marked` is configured with `headerIds: false` and the default renderer does not emit
   attributes from source), then sanitized with `sanitize-html` down to a fixed allowlist
   (`p, a, strong, em, code, pre, blockquote, ul, ol, li, h2-h4, img`) before render. Defense in
   depth: even though (1) already blocks HTML at write time, (2) means a future change to the write
   path (or a row edited directly in the database) still can't render as script-executing markup.

No rich-text/WYSIWYG framework was added — the editor is a plain `<textarea>` plus the same
sanitizing renderer used publicly, toggled by a "Preview" tab (`PostEditor.tsx`).

## API

```
GET    /api/v1/admin/posts             — full status visibility, search, status filter, pagination
GET    /api/v1/admin/posts/:id
POST   /api/v1/admin/posts             — always created DRAFT
PATCH  /api/v1/admin/posts/:id         — status excluded from the DTO; re-validates if published
DELETE /api/v1/admin/posts/:id
POST   /api/v1/admin/posts/:id/workflow — { transition: draft | review | publish | archive }
GET    /api/v1/admin/posts/:id/preview  — same as GET :id, alias kept for the CMS preview route

GET    /api/v1/posts                    — PUBLISHED only, paginated, optional ?tag=
GET    /api/v1/posts/:slug              — PUBLISHED only, 404 for draft/review/archived
```

All admin routes: `JwtAuthGuard` + `CsrfGuard` (`AdminPostsController`, same class-level guard
pattern as `AdminProjectsController`). Public routes are unguarded, in a separate controller class.
Every mutation writes an `AuditLog` row inline (`POST_CREATED`, `POST_UPDATED`, `POST_DELETED`,
`POST_SENT_TO_REVIEW`, `POST_PUBLISHED`, `POST_UNPUBLISHED`, `POST_ARCHIVED`) — no separate
audit-log service, matching the rest of the codebase.

## Migration of existing static content

`apps/web/lib/content.ts` held four `ArticleRecord`s with real titles/slugs but placeholder
excerpt/body text ("Draft seed — article content is not yet published."). `prisma/seed-content.ts`
now upserts these four as `BlogPost` rows keyed by slug (idempotent — `upsert`, safe to re-run),
preserving title, slug, and the existing placeholder excerpt/body verbatim (no wording invented) —
they migrate in as `DRAFT` posts, since the source content was explicitly marked `status: 'draft'`
and has no real article body yet. `category`/`readingTime`/`author` from `ArticleRecord` have no
`BlogPost` equivalent for category (relational `BlogCategory` instead of a free string) — a single
`Field Notes` category row is created and attached; `readingTime` and `relatedProjects`/
`relatedArticles` are dropped (no database field for the first, empty arrays for the others — no
data loss). `author` matches the seed's existing `Profile.name` convention and isn't stored
per-post (the site has one author).

`apps/web/app/notes/page.tsx`, `apps/web/app/notes/[slug]/page.tsx`, and `FieldNotesSection` in
`apps/web/components/HomeSections.tsx` now read from `apps/web/lib/public-content.server.ts`
(`getPublishedPosts`/`getPublishedPostBySlug`, added alongside the existing project functions) —
the static `notes` array in `content.ts` is unused by any route after this change but is left in
place as the seed's source of truth and as the `ALLOW_STATIC_CONTENT_FALLBACK` fallback (same flag
Sprint 2 introduced for projects — off by default, including in CI).
