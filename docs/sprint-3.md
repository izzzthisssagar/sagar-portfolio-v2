# Sprint 3 — Content, Media, Documents and Contact

## Goal

Build the content, media, document and contact-management layer on top of Sprint 2's
authentication and project CMS. By the end of Sprint 3 the administrator can create/publish Field
Notes, upload and approve media, attach evidence to projects, manage a portrait and CV, and receive
contact messages with delivery tracking; the public site serves all of this from PostgreSQL with
database-backed SEO.

## In scope

- Field Notes (`BlogPost`) persistence, publication workflow, admin CMS, public list/detail.
- Migration of the four existing static Field Notes into the database (content preserved verbatim).
- Media pipeline: quarantine → validate → approve/reject, storage adapter abstraction (local +
  S3-compatible), admin media library.
- Project evidence: attach approved media to projects with a confirmed/pending/unavailable status,
  separate from publication status.
- Portrait selection (one active `MediaAsset` at a time) and CV management (upload, activate,
  archive, public download route).
- Contact message persistence, honeypot/throttle protection, and an email-delivery adapter
  (capture adapter for dev/test, SMTP adapter for production) with delivery-attempt tracking.
- Database-backed SEO: canonical URLs, Open Graph/Twitter metadata, `sitemap.xml`, JSON-LD
  structured data (`Person`/`WebSite`, `CreativeWork`, `Article`).
- Dashboard counts extended to cover posts, media, evidence and contact/notification state.
- Unit, PostgreSQL integration, and Playwright/axe coverage for every vertical above.

## Explicitly out of scope (later sprints)

- Final GLB asset production, advanced scroll choreography, playable QA Rift.
- Blog comments, public user accounts, newsletter subscriptions.
- Analytics dashboards, video upload, arbitrary HTML editing, AI-generated evidence.

## What Sprint 1 and 2 already provide (not rebuilt)

Single-administrator auth (Argon2id, access/refresh rotation, `tokenVersion` revocation, CSRF),
project CMS and publication workflow, PostgreSQL/Prisma, CI. See `docs/sprint-1.md` and
`docs/sprint-2.md`. The `BlogPost`, `MediaAsset`, `ContactMessage` and `ProjectMedia` Prisma models
already existed in the schema before Sprint 3 (drafted ahead in Sprint 1) but had **no** controller,
service, storage, or admin UI — every vertical below is greenfield at the application layer even
though some tables pre-date this sprint. Confirmed by inspection: no `BlogModule`/`MediaModule`/
`ContactModule` existed, `apps/web/app/notes/*` read a hardcoded static array
(`apps/web/lib/content.ts`), and `/admin/posts`, `/admin/media`, `/contact` were unwired
placeholders.

## Delivery order and status

Built as independent, complete verticals (schema → API → admin UI → public wiring → tests) rather
than in one cross-cutting pass, so each phase ships in a working state:

1. **Field Notes** — schema extension, admin+public API, admin CMS, static-content migration,
   public `/notes` wired to the database. See `docs/field-notes.md`.
2. **Media pipeline** — storage adapters, upload/validation, quarantine/approve/reject, admin
   media library. See `docs/media-pipeline.md`.
3. **Project evidence, portrait, CV** — built on top of the media pipeline.
4. **Contact** — message persistence, delivery adapter, CMS inbox, public form. See
   `docs/contact-delivery.md`.
5. **SEO** — database-backed metadata, sitemap, structured data, and public media delivery
   hardening (immutable/ETag caching). See `docs/seo.md`.

Each doc states plainly whether its vertical is implemented, partially implemented, or design-only
at the time it was last updated — check the "Status" line at the top of each doc rather than
assuming Sprint 3 completed everything in a single commit.

## Configuration

New environment variables introduced this sprint (all optional in development/test; production
fails closed when required ones are missing — see the individual docs):

```
MEDIA_STORAGE_DRIVER=local|s3
MEDIA_STORAGE_LOCAL_PATH=./.data/media
MEDIA_STORAGE_ENDPOINT=
MEDIA_STORAGE_REGION=
MEDIA_STORAGE_BUCKET=
MEDIA_STORAGE_ACCESS_KEY=
MEDIA_STORAGE_SECRET_KEY=
MEDIA_STORAGE_PUBLIC_BASE_URL=
MEDIA_MAX_IMAGE_BYTES=8388608
MEDIA_MAX_PDF_BYTES=15728640
CONTACT_NOTIFICATION_DRIVER=capture|smtp
CONTACT_NOTIFICATION_TO=
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=
PUBLIC_SITE_URL=
```

## Known limitations

- No real portrait or CV file is committed — the user has not supplied and approved one. The
  media/portrait/CV plumbing works end-to-end against test fixtures; the public pages render a
  deliberate "not configured" fallback until a real asset is uploaded and approved.
- Numazu Halal Food's screenshot evidence stays `PENDING` — no invented screenshot is added.
- Production S3 and SMTP adapters are implemented and unit-tested against their interfaces but not
  exercised against a real bucket or mail server (no credentials available in this environment);
  both fail closed when required configuration is absent, per the stop conditions in the sprint
  brief.
- The full local Playwright suite occasionally hits the app-wide `ThrottlerGuard` budget (60
  requests/60s per IP — `apps/api/src/app.module.ts`, predates Sprint 3): the suite's own necessary
  request volume (dozens of page loads, each triggering several API calls) can exceed 60 within a
  single 60-second window purely from running the suite, regardless of concurrency — confirmed by
  direct reproduction (curling `/health` 70 times in a row starts returning 429 at request 61) and
  by observing the same intermittent failure persist even pinned to a single Playwright worker
  (`playwright.config.ts`, `workers: 1` — kept as a partial mitigation; it reduces burstiness even
  though it doesn't eliminate the failure mode). The limit itself was deliberately left unchanged
  rather than loosened, since it's a pre-existing security control from Sprint 1/2, not a Sprint 3
  defect — raising or scoping it is a product decision for Sprint 4 (e.g. exempt read-only/health
  routes from the global throttle, or raise the authenticated-admin budget). A CI run that trips
  this should be re-run; it is not a sign of a broken feature.
