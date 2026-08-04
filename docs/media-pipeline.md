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

## Reconciliation (`pnpm media:reconcile`)

The upload/approve/archive pipeline above keeps the `MediaAsset` table and the storage backend in
agreement in the normal case, but they can still drift apart out-of-band — a manual storage
operation, a database restore into an environment with a different bucket, a crash between an
object move and its DB update (`applyRepairs`'s own compensation logic aside, this is why the
check exists at all). `apps/api/scripts/media-reconcile-lib.ts` holds the pure detection/repair
logic (unit-tested against fakes in `media-reconcile-lib.test.ts`); `apps/api/scripts/media-reconcile.ts`
is the CLI wiring it to the real `PrismaService` and the configured `MediaStorageAdapter`
(`buildMediaStorageAdapter()`, same selection logic the running API uses).

**Default is dry-run and read-only.** `pnpm media:reconcile` never writes to storage or the
database unless `--repair --yes` is passed. `--json` prints machine-readable output; otherwise a
human-readable summary. Exits non-zero if any `error`-severity finding is present (CI-friendly).

Checks performed, each producing a `Finding` with a `FindingCode`:

| Code                                                            | Severity | Meaning                                                                                                                                                                                                |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MISSING_OBJECT`                                                | error    | A `MediaAsset` row's `storageKey` has no backing object.                                                                                                                                               |
| `STATUS_PREFIX_MISMATCH`                                        | error    | The object's key prefix (`quarantine/`/`approved/`/`archived/`) disagrees with `status` (`REJECTED` is expected to still carry `quarantine/` — rejection never moves storage, see `media.service.ts`). |
| `ORPHANED_OBJECT`                                               | warning  | An object exists in storage with no `MediaAsset` row referencing it.                                                                                                                                   |
| `DUPLICATE_STORAGE_KEY`                                         | error    | Two rows share a `storageKey` (should be impossible given the DB unique constraint; checked defensively).                                                                                              |
| `CHECKSUM_MISMATCH`                                             | error    | Opt-in only (`--verify-checksums`, downloads every referenced object) — recomputed SHA-256 disagrees with `MediaAsset.sha256`.                                                                         |
| `CV_NOT_CONFIGURED`                                             | info     | No `CvDocument` is `active` (or none exists at all) — a valid, expected state, not an error.                                                                                                           |
| `ACTIVE_CV_OBJECT_MISSING`                                      | error    | The active `CvDocument`'s media has no backing object — the public CV route will fail.                                                                                                                 |
| `PORTRAIT_NOT_CONFIGURED`                                       | info     | `Profile.portraitMediaId` is unset — valid, expected state.                                                                                                                                            |
| `PORTRAIT_OBJECT_MISSING`                                       | error    | The configured portrait's media has no backing object.                                                                                                                                                 |
| `FEATURED_IMAGE_OBJECT_MISSING` / `SOCIAL_IMAGE_OBJECT_MISSING` | error    | A `BlogPost`'s featured/social image media has no backing object.                                                                                                                                      |
| `PROJECT_MEDIA_OBJECT_MISSING`                                  | error    | A project evidence image's media has no backing object.                                                                                                                                                |

**Repair mode (`--repair --yes`)** only auto-fixes `STATUS_PREFIX_MISMATCH` — moving the object to
the storage prefix its DB status says it belongs at, exactly mirroring the direction
`media.service.ts` itself moves objects on approve/archive. It never touches `MISSING_OBJECT`,
`ORPHANED_OBJECT`, or `CHECKSUM_MISMATCH` findings (these require a human decision — re-upload,
clear a reference, or manually inspect/delete — never an automated guess) and never infers a
`status` from where an object happens to sit (it cannot mark something `APPROVED` merely because
an object exists at `approved/...`). Each repair action is conservative: refuses to move a source
object that no longer exists, refuses to overwrite an already-occupied destination key, and if the
DB update fails after a successful object move, moves the object back so storage and DB stay in
agreement (the same compensation pattern `media.service.ts` already uses). One action's failure
never aborts the batch. A successful repair run writes one `AuditLog` row
(`action: 'media.reconcile.repair'`) recording the finding/action counts and per-action outcome —
never the object bytes or any secret.

Storage backends implement two reconciliation-only methods beyond the upload/approve/archive
pipeline's `put`/`get`/`move`/`delete`/`publicUrl`/`ping`: `exists(key)` (a HEAD-equivalent
existence check, never downloads the body) and `list()` (full key enumeration — a recursive
directory walk for `LocalStorageAdapter`, a paginated `ListObjectsV2` for `S3StorageAdapter`).
Neither is called from any request-serving code path — only from `pnpm media:reconcile`.
