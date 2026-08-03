# CMS content model

## Project

`Project` (`prisma/schema.prisma`) carries the editorial fields
(`title`, `slug`, `summary`, `overview`, `context`, `responsibilities`, `systemMap`,
`testStrategy`, `fixAndRetest`, `outcome`, `lessons`), a `sceneState` (drives the public System
Under Test scene: `sealed | exploded | mastery | inspection | fault | verified | rift`), a
`status` (`PublicationStatus`: `draft | review | published | archived`), a manual `order` for
display sequencing, and `publishedAt` (set once, the first time a project transitions to
`published`; untouched by later unpublish/republish so it always reflects the original
publication date — this is a deliberate choice, not yet exposed as "first published" vs.
"republished" distinction because Sprint 2 doesn't need that nuance).

## Metrics and findings

`ProjectMetric` (`label`, `value`, `evidence`, `sourceNote`, `order`) and `ProjectFinding`
(`title`, `summary`, `severity`, `evidenceStatus`, `order`) both belong to a `Project` and both
carry an `EvidenceStatus` (`CONFIRMED | PENDING | UNAVAILABLE`). This is the mechanism that keeps
the "never invent evidence" rule enforceable in the data model rather than just in prose: a metric
or finding without confirmed evidence is stored as `PENDING`/`UNAVAILABLE` and the public API and
UI must show that distinction rather than rendering it as settled fact (`docs/content-evidence.md`
covers the broader site-wide policy this extends).

Admin routes: `/api/v1/admin/projects/:projectId/metrics[/:metricId|/reorder]` and the equivalent
under `/findings`. Create/update/delete/reorder each run inside a Prisma transaction and write an
audit event (`METRIC_CREATED`, `METRIC_REORDERED`, ...). `reorder` takes the full ordered id list
for the project and rejects (400) if it doesn't exactly match that project's current children —
this catches stale-client races (someone deleted a row while you were dragging) instead of
silently reordering a subset.

## Publication workflow

`POST /api/v1/admin/projects/:id/workflow` with `{ transition: 'draft' | 'review' | 'publish' |
'archive' }` is the only way `status` changes. The generic `PATCH /admin/projects/:id` DTO
excludes `status` entirely (`UpdateProjectDto = PartialType(OmitType(CreateProjectDto,
['status']))`) and the validation pipe's `forbidNonWhitelisted` rejects a `status` field in that
body with 400 — so there's exactly one code path that can publish something, and it's the one with
the validation below.

`publish` is the only transition with content requirements
(`apps/api/src/projects/publication-rules.ts`): title, slug, summary, and overview must be
present, and at least one of `responsibilities` or `testStrategy` must be present. Failing that
returns `400 PUBLICATION_INVALID` with a `details` array of the specific missing pieces. `draft`,
`review`, and `archive` have no content gate — you can always retreat a project to draft or shelve
it, only forward-to-published is guarded. Every transition writes a distinct audit action
(`PROJECT_PUBLISHED`, `PROJECT_UNPUBLISHED`, `PROJECT_SENT_TO_REVIEW`, `PROJECT_ARCHIVED`).

## Public visibility

`GET /api/v1/projects` and `GET /api/v1/projects/:slug` (`ProjectsController`, no guard) only ever
query `status = PUBLISHED`. There is no query parameter that can widen that — `ListProjectsDto`
(admin) has a `status` filter, `PublicListProjectsDto` (public) does not. A slug that exists but
isn't published returns a plain `404`, identical in shape to a slug that doesn't exist at all, so
the public API never signals "this exists but isn't public yet."

## Draft preview

`/admin/projects/:id/preview` (Next.js, inside the authenticated CMS layout) renders a project
regardless of status by calling the _admin_ API (`GET /admin/projects/:id`, guarded) — it never
touches the public API or public routes, carries a visible "DRAFT PREVIEW" banner, sets
`noindex, nofollow` and `Cache-Control: no-store`, and performs no mutation. Because it's served
under `/admin/*`, the existing session guard (`docs/authentication.md`) already keeps it behind
authentication; no new access-control surface was added for it.

## Content seed

`pnpm db:seed` (`prisma/seed.ts`) is idempotent (upserts by slug) and inserts exactly the two
projects with real, supplied content:

- **QA Mastery** — `published`, four `CONFIRMED` metrics (876+ notes, 48 modules, 13 workspaces, 3
  practice surfaces), the supplied authorship statement as `overview`, live/GitHub links.
- **Numazu Halal Food** — `draft`, one `PENDING`-evidence finding describing the double-discount
  defect (MRP − discount + shipping + VAT = total; the discount was applied a second time at
  checkout). Screenshots, external verification, and production outcome stay `UNAVAILABLE` until
  supplied — the seed does not publish this project and nothing in Sprint 2 does either.

No other project content is invented. The three placeholder Sprint 1 static entries
(`api-security-testing`, `performance-testing`, `automation-testing`) are not seeded into the
database — they had no real evidence behind them, and Phase 10 replaces the static content source
entirely, so keeping fabricated placeholders alive in the database would recreate exactly the
problem the evidence-status model exists to prevent. They can return in a later sprint once real
project content exists for them.
