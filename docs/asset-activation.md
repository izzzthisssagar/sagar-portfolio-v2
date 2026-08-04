# Portrait and CV asset activation

Status (confirmed 2026-08-04, Sprint 4 Phase 22): **portrait — NOT CONFIGURED. CV — NOT
CONFIGURED.** This is a deliberate, expected state (see `docs/sprint-3.md`, "No real portrait or
CV file is committed"), not a bug. This document records how that was verified, what the public
site shows in the meantime, and the exact steps to activate real files once they are supplied and
approved. It does not fabricate or introduce any portrait image or CV PDF — see "Hard rule" at the
bottom.

## 1. Current status, as verified

Verification method: read the relevant service/controller code, then confirmed live against a
running instance of this codebase (the project's staging containers, `portfolio-staging-api` /
`portfolio-staging-web`, already up with real migrations and the real content seed applied — no
throwaway container was needed since a live, seeded instance was already running).

```
$ curl -s http://localhost:14000/api/v1/profile
{"data":{"name":"Sagar Thapa","headline":"Quality Engineer","bio":"I investigate interfaces, ..."}}

$ curl -s http://localhost:14000/api/v1/profile/portrait
{"data":null}

$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:14000/api/v1/documents/cv
404
```

- `GET /api/v1/profile` returns the real seeded profile (name/headline/bio) — the Profile row
  exists (seeded by `prisma/seed-content.ts`, `seedProfile()`), confirming this isn't a missing-row
  problem.
- `GET /api/v1/profile/portrait` returns `{"data": null}` — no `Profile.portraitMediaId` is set.
  This is the deliberate, non-error contract: `ProfileService.getPublicPortrait()`
  (`apps/api/src/profile/profile.service.ts:37-47`) returns `null` whenever `portraitMedia` is
  absent or not `APPROVED`; the controller (`apps/api/src/profile/profile.controller.ts:15-17`)
  wraps it as `{ data: null }` with a `200`, never an error.
- `GET /api/v1/documents/cv` returns `404`. `CvService.getActivePublic()`
  (`apps/api/src/cv/cv.service.ts:126-133`) returns `null` when no `CvDocument` row has
  `active: true` (or the active row's media isn't `APPROVED`); the controller
  (`apps/api/src/cv/cv.controller.ts:33-35`, `CvDownloadController.downloadCv`) turns that `null`
  into a `NotFoundException` — "a deliberately unavailable state, not a broken one" per the
  handler's own comment.

Both code paths were also read directly and confirmed to fail _cleanly_ — no thrown errors, no
500s, no null-pointer risk — for the "nothing configured" case:

- `apps/api/src/profile/profile.service.ts` — `getPublicPortrait()` short-circuits on
  `!portrait || portrait.status !== MediaStatus.APPROVED`.
- `apps/api/src/cv/cv.service.ts` — `getActivePublic()` short-circuits on
  `!doc || doc.media.status !== MediaStatus.APPROVED`.

No new database, container, or migration run was needed for this verification; the existing
staging stack already reflects the production seed (`prisma/seed-content.ts`), which deliberately
does not set a portrait or activate a CV (see its `seedProfile()` comment: "Portrait and CV
activation are admin actions ..., not seeded here"). No containers were started or torn down for
this task.

## 2. What the public site shows today

Confirmed against the same running staging build (`http://localhost:13000/` and `/about`) — both
fallback strings render exactly as follows:

- **Homepage hero CV button** (`apps/web/components/HomeSections.tsx:29-37`, `Hero`): when
  `cvAvailable` is `false` (from `getCvAvailable()` in
  `apps/web/lib/public-content.server.ts:181-191`, which does a `HEAD /documents/cv` and reports
  availability by `response.ok`), the button renders as a disabled `<span>` reading:

  ```
  DOWNLOAD CV — PENDING
  ```

  with `aria-disabled="true"` and `title="CV has not yet been supplied"`.

- **About section portrait slot** (`apps/web/components/HomeSections.tsx:212-237`,
  `AboutSection`, used on both `/` and `/about`): when `portrait` is `null` (from
  `getActivePortrait()` in `apps/web/lib/public-content.server.ts:172-175`), it renders a
  placeholder `<div role="img" aria-label="Portrait placeholder — approved portrait pending">`
  containing:

  ```
  PORTRAIT ASSET PENDING
  Expected: /assets/images/portrait/sagar-portrait.png
  ```

Both are deliberate, accessible, non-broken placeholders — not errors, not blank space, not a
fabricated image or a fake download link.

## 3. Pipeline already tested end-to-end with generated fixtures

`apps/api/test/portrait-cv.api.integration.test.ts` is a full integration suite (real Nest app,
real Postgres via `DATABASE_URL`, `supertest`) that proves the upload → approve → activate flow
works, using only generated/synthetic bytes — no real photo or PDF file is read from disk or
committed anywhere in the repo:

- **Synthetic image fixtures**: `uploadApprovedImage()` (lines 87–106) generates a tiny in-memory
  PNG via `sharp({ create: { width: 4 + imageSeed, height: 4, channels: 3, background: '#ff5a35' } })
.png().toBuffer()` — a solid-color raster with no real photographic content.
- **Synthetic PDF fixtures**: `uploadApprovedPdf()` (lines 108–127) builds a minimal, valid-enough
  PDF by hand: `` `%PDF-1.4\n1 0 obj<</Type/Catalog/Seed ${pdfSeed}>>endobj\ntrailer<</Root 1 0
R>>\n%%EOF` `` — not a real résumé/CV document.

What the suite proves, with the exact assertions:

- **Upload → approve → activate as portrait, then serve publicly, then clear** (lines 157–182):
  uploads a synthetic image, approves it, `POST /api/v1/admin/profile/portrait` activates it,
  `GET /api/v1/profile/portrait` returns it publicly, `GET /api/v1/media/:id/file` serves it with
  the correct `Content-Type`, and `DELETE /api/v1/admin/profile/portrait` clears it back to
  `null`.
- **Rejects invalid portrait candidates**: a still-quarantined image (lines 130–146) and a PDF
  (lines 148–155) are both rejected with `400` when submitted as the portrait —
  `PORTRAIT_REQUIRES_APPROVED_IMAGE`.
- **Upload → approve → register → activate as CV, then serve publicly with a safe filename**
  (lines 241–255): registers a synthetic PDF as a `CvDocument`, activates it, and confirms
  `GET /api/v1/documents/cv` returns `200` with `Content-Type: application/pdf` and
  `Content-Disposition` containing the fixed filename `Sagar-Thapa-CV.pdf` — never the internal
  media id (`.not.toContain(pdfId)`).
- **Single-active-CV constraint is enforced**, both sequentially and under concurrency:
  - Sequential (lines 257–288): activating CV B after CV A deactivates A; only B is `active`; the
    active document can't be deleted (`409`), the inactive one can.
  - Concurrent (lines 321–363): two CV documents are activated with `Promise.all` from a fully
    inactive starting state — exercising the exact race the partial unique index
    `CvDocument(active) WHERE active` (migration
    `20260803090512_cv_document_single_active_constraint`) exists to prevent. The test asserts
    every response is either `201` or `409` (never a `500`), that **exactly one** row ends up
    `active`, and that the losing activation leaves no partial/dangling state.
- **The CV PDF is never reachable through the generic public media route** (lines 290–319), active
  or not — only `GET /api/v1/documents/cv` serves it.
- **404 from the public download route when no CV is active** (lines 237–239) — the same
  not-configured behavior confirmed live in §1.
- **Alt-text invariant on the active portrait** (lines 205–224): an approved, non-decorative,
  active portrait can't have its alt text cleared unless also marked decorative.

This is the Sprint 3 evidence that the pipeline itself is production-ready; what's missing is
only the real files, per Phase 22's explicit instruction not to fabricate them.

## 4. Production activation steps (for when real files are supplied and approved)

These are the actual existing UI flows — read directly from
`apps/web/app/admin/(cms)/settings/page.tsx`, `apps/web/components/PortraitSettings.tsx`,
`apps/web/components/CvSettings.tsx`, `apps/web/app/admin/(cms)/media/page.tsx`, and
`apps/web/components/MediaDetailForm.tsx` — not an invented process.

### a. Log into the CMS

Sign in at `/admin/login` (`apps/web/app/admin/login/page.tsx`) with the admin credentials
(`ADMIN_EMAIL` / the account matching `ADMIN_PASSWORD_HASH`). This issues the access/refresh
tokens the rest of the admin UI (and the endpoints below) require.

### b. Upload the real file through the media library

1. Go to **Admin → Media** (`/admin/media`).
2. Use the upload form at the top of the page (`MediaUploadForm`, posts to
   `POST /api/v1/admin/media`, `apps/api/src/media/media.controller.ts:63-78`).
3. The file lands as a new `MediaAsset` row with `status: QUARANTINED` — it is not publicly
   reachable yet.

Constraints enforced server-side at upload (`apps/api/src/media/media-validation.ts`):

- **Portrait (image)**: JPEG, PNG, WebP, or AVIF only (AVIF only if the deployed `sharp`/libvips
  build supports it — probed at startup, see `avifSupported()`); classified by file-signature
  bytes, not by extension or declared `Content-Type`; max size `MEDIA_MAX_IMAGE_BYTES` (default
  8 MiB, `DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024`); a claimed extension that disagrees with the
  detected type is rejected (`EXTENSION_MISMATCH`); the schema has no hard-coded pixel-dimension
  requirement — `Profile.portraitMediaId` and `MediaAsset.width`/`height` are stored but not
  validated against a minimum/maximum.
- **CV (document)**: PDF only; max size `MEDIA_MAX_PDF_BYTES` (default 15 MiB,
  `DEFAULT_MAX_PDF_BYTES = 15 * 1024 * 1024`); password-protected/encrypted PDFs are rejected
  (`ENCRYPTED_PDF`, detected via the `/Encrypt` trailer key heuristic in `looksEncrypted()`).
- Anything that isn't a recognized image or PDF signature is rejected outright
  (`UNRECOGNIZED_FILE_TYPE` / `DISALLOWED_TYPE`) — SVG, executables, HTML, scripts, etc.

### c. Approval

1. Open the uploaded asset's detail page: **Admin → Media → (the file)**
   (`/admin/media/[id]`, `MediaDetailForm`).
2. Set **alt text** (required for a content-bearing image unless marked **decorative** — the
   portrait should get real alt text, not be marked decorative) and click **Approve**
   (`POST /api/v1/admin/media/:id/approve`, `MediaService.approve()` in
   `apps/api/src/media/media.service.ts:199-249`). This moves the object from `quarantine/` to
   `approved/` storage and flips `status` to `APPROVED` — only now is it eligible to be activated.

### d. Activate as the live portrait / CV

**Portrait** — **Admin → Settings** (`/admin/settings`) → the **Portrait** section
(`PortraitSettings`):

1. Select the newly approved image from the **Approved image** dropdown (populated from
   `GET /api/v1/admin/media?status=approved&category=image`).
2. Click **SET PORTRAIT** → calls `POST /api/v1/admin/profile/portrait` with `{ mediaId }`
   (`ProfileService.setPortrait()`, `apps/api/src/profile/profile.service.ts:49-77`), which
   requires the media to be `category: IMAGE` and `status: APPROVED` and writes
   `Profile.portraitMediaId`.
3. The homepage/About page will immediately start rendering the real portrait instead of the
   `PORTRAIT ASSET PENDING` placeholder (revalidated within 60s per the `next: { revalidate: 60 }`
   fetch tag in `public-content.server.ts`).

**CV** — same **Admin → Settings** page, **CV** section (`CvSettings`):

1. Select the newly approved PDF from the **Approved PDF** dropdown, enter a **Title** (and
   optional **Version note**).
2. Click **REGISTER CV VERSION** → `POST /api/v1/admin/cv` (`CvService.create()`,
   `apps/api/src/cv/cv.service.ts:31-60`) creates a `CvDocument` row (inactive by default).
3. Click **ACTIVATE** next to that document → `POST /api/v1/admin/cv/:id/activate`
   (`CvService.activate()`, lines 69-99). This deactivates any previously active CV and activates
   the new one inside a transaction, backed by the partial unique index
   `CvDocument(active) WHERE active` for correctness under concurrent activation attempts.
4. The homepage hero button will switch from `DOWNLOAD CV — PENDING` to a live `DOWNLOAD CV` link
   pointing at `GET /api/v1/documents/cv`, which now serves the new PDF as
   `Sagar-Thapa-CV.pdf`.

No other steps are required — both settings take effect the moment the request succeeds, subject
to the web app's 60-second revalidation window for already-cached pages.

## 5. Before uploading a real file: what to do first

- **Never commit a real portrait image or CV PDF into git.** The media pipeline (object storage +
  `MediaAsset` row, quarantine → approve → activate) exists specifically so binary content lives
  outside source control, is validated, and can be replaced/rotated/archived without a code
  change or deploy. Use the upload flow in §4, not a file added to `apps/web/public/` or similar.
- **EXIF/metadata stripping for the portrait image already happens automatically** — no manual
  step needed. `MediaService.upload()` (`apps/api/src/media/media.service.ts:109-119`) re-encodes
  every uploaded image through `sharp(file.buffer).rotate().toBuffer()` before it's ever written to
  storage. Per the code's own comment: "Re-encoding through sharp (rather than storing the
  uploaded bytes verbatim) strips embedded metadata (EXIF/ICC/XMP) as a side effect of
  decode+re-encode, on top of the explicit `.rotate()` bake-in — sharp's default output already
  omits source metadata unless `.withMetadata()` is called." This was confirmed by reading the
  code, not assumed; `docs/media-pipeline.md` independently documents the same behavior ("Raster
  images are re-encoded through `sharp` ... this strips embedded scripts/macros/most metadata").
  This applies to the **portrait image only** — PDFs (the CV) are stored byte-for-byte with no
  re-encoding step, so **PDF metadata (author, producer/creator software, embedded XMP, etc.) is
  not stripped by this pipeline.** If the real CV PDF's metadata shouldn't be public, strip it
  manually before upload (e.g. `exiftool -all= file.pdf` or export a "clean" copy from the
  originating word processor) — this is a manual pre-upload step, not something the system does
  for you.
- Double-check the real file doesn't embed anything sensitive beyond metadata (e.g. tracked
  changes, hidden text, speaker notes) before uploading, since approval makes it publicly
  downloadable/viewable.

## Hard rule

This document is about the activation _procedure_. It does not include, reference, download, or
stage any real portrait image or CV file, and none was created, fetched, or committed as part of
writing it.
