# Media pipeline

Status: **implemented** — storage adapters (local + S3-compatible, fail-closed in production),
upload/validation pipeline, quarantine/approve/reject workflow, admin media library, and the public
delivery route are all live. Public delivery is cached as immutable with a SHA-256 ETag (content
is content-addressed, so a given asset id never changes bytes) — see `docs/seo.md` for the Phase 18
hardening details.

## Security model

Every upload starts `QUARANTINED` and is invisible to any public route. Nothing served to
unauthenticated users is ever read directly from an admin-supplied path or filename — public
delivery only ever serves a `MediaAsset` row whose `status === APPROVED`, addressed by its
database id / content-addressed storage key, never by the original filename.

Validation never trusts the browser: `Content-Type` and the original filename are used for display
only. The upload is classified by inspecting file-signature (magic) bytes server-side, cross-checked
against the declared MIME type; a mismatch is rejected regardless of extension.

Allowed formats:

- Images: JPEG, PNG, WebP, AVIF (only if the deployed `sharp` build decodes AVIF reliably — checked
  at startup; if not, AVIF is excluded from the allowlist rather than silently accepted and mangled).
- Documents: PDF only.
- Rejected outright, unconditionally: SVG, any executable/script format, HTML, JavaScript, any file
  whose detected signature disagrees with its extension, malformed or password-protected PDFs where
  detection is practical, anything over the configured size ceiling.

Raster images are re-encoded through `sharp` (not passed through byte-for-byte) — this strips
embedded scripts/macros/most metadata as a side effect of decode+re-encode, in addition to an
explicit metadata-strip step, and normalizes the stored format.

## Storage abstraction

```ts
interface MediaStorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string | null; // null when the key isn't publicly addressable
}
```

Storage keys are content-addressed (derived from the SHA-256 checksum) — never the raw uploaded
filename — which also gives free upload-dedup detection and prevents path traversal by
construction (no user input reaches the filesystem path).

Adapters:

1. **Local** (`MEDIA_STORAGE_DRIVER=local`) — writes under `MEDIA_STORAGE_LOCAL_PATH`, split into
   `quarantine/` and `approved/` subdirectories so quarantined files are never reachable through
   the approved-asset delivery route even by key guess. Default in development and test.
2. **S3-compatible** (`MEDIA_STORAGE_DRIVER=s3`) — configured only via
   `MEDIA_STORAGE_ENDPOINT/_REGION/_BUCKET/_ACCESS_KEY/_SECRET_KEY/_PUBLIC_BASE_URL`. Production
   must set `MEDIA_STORAGE_DRIVER=s3` with full configuration; the app fails closed at startup
   (throws, does not boot) if `NODE_ENV=production` and any required S3 variable is missing, rather
   than silently falling back to local disk in a production container.
3. **In-memory fake** — used by unit tests only, never selected by `MEDIA_STORAGE_DRIVER`.

Deletion removes (or archives, for the `archive` status transition) both the database row's status
and the underlying object together — never one without the other, so a deleted DB row can't leave
an orphaned public object and an archived object can't stay downloadable through a guessed key.

## Upload and approval workflow

`POST /api/v1/admin/media` (multipart, `JwtAuthGuard` + `CsrfGuard`, request-size-limited):

1. Enforce request size limit before reading the body.
2. Inspect signature bytes → classify type; verify against declared MIME; reject on mismatch.
3. Compute SHA-256; if a `MediaAsset` with the same checksum already exists, short-circuit (surface
   the existing asset rather than storing a duplicate).
4. Re-encode images through `sharp`, strip metadata, record width/height.
5. Store under quarantine; create the `MediaAsset` row `status = QUARANTINED`; write an audit
   log entry (`MEDIA_UPLOADED`).

`POST /api/v1/admin/media/:id/approve` requires `altText` for content-bearing images (a
`decorative: true` flag on the asset explicitly opts out); moves the object from quarantine to
approved storage and flips `status = APPROVED` in the same transaction outcome (object move
happens first — if it fails, the DB row stays `QUARANTINED` rather than recording an approval that
isn't actually servable). `POST /api/v1/admin/media/:id/reject` requires a reason and never makes
the file reachable publicly. Both write an audit entry.

## Configuration

See the env var block in `docs/sprint-3.md`. `MEDIA_MAX_IMAGE_BYTES` / `MEDIA_MAX_PDF_BYTES` bound
request size per category before any parsing happens.
