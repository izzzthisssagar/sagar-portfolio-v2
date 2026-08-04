# Runbook: storage unavailable

## Symptoms

- `GET /api/v1/health/ready` returns `503` with `storage: false`.
- Media upload/approve/archive requests fail; public media downloads (`GET /api/v1/media/:id/file`,
  `GET /api/v1/documents/cv`, `/api/v1/profile/portrait`) fail or 5xx.
- Liveness (`/health/live`) stays `200` — correct, by design (`docs/operations.md`).

## Immediate containment

- No action needed to "stop" anything — readiness `503` already prevents new traffic from being
  routed to an instance that can't serve media, and every storage-dependent write path fails
  loudly rather than silently succeeding with a broken reference.
- Do not disable the readiness check or route around it "to keep the site up" — a site serving
  pages but silently failing every image/CV/portrait request is a worse outcome than an honest
  `503`.

## Diagnosis

```bash
# What the readiness probe itself concluded (never leaks endpoint/credential detail):
curl -s https://<api-host>/api/v1/health/ready | jq '.checks[] | select(.name == "storage")'
```

- **Local driver** (`MEDIA_STORAGE_DRIVER=local`): the storage root directory
  (`MEDIA_STORAGE_LOCAL_PATH`) is missing, not writable, or the volume it lives on is full/detached.
  Check disk space and mount status on the host — this driver is not expected in a real production
  deployment (`docs/deployment.md` requires `s3` in production) but may appear in a
  local/single-host rehearsal.
- **S3-compatible driver**: `S3StorageAdapter.ping()` failed a `HeadBucket` call — endpoint
  unreachable, bucket doesn't exist, or credentials are wrong/expired. None of these are
  distinguishable from the readiness response by design (it never leaks which); check the actual
  provider's status/console, or run a manual `aws s3 ls s3://<bucket> --endpoint-url <endpoint>`
  (or equivalent) with the same credentials the API uses, outside the application, to get a real
  error message.

## Safe recovery

- **Transient endpoint outage**: no application action needed once the endpoint is reachable again;
  confirm with the readiness check.
- **Credentials rotated/expired**: update `MEDIA_STORAGE_ACCESS_KEY`/`MEDIA_STORAGE_SECRET_KEY` (or
  the local path) in the deployment's environment and restart.
- **Bucket deleted or renamed**: this is a configuration error, not data loss by itself — but any
  object that was only ever in that bucket is now unreachable. Do not create a new bucket and
  assume it's equivalent; after pointing at the correct/recreated bucket, run
  `pnpm media:reconcile` (see `docs/media-pipeline.md`) to find out exactly what's actually missing
  before assuming anything is fine.

## After storage is reachable again: check for drift

A storage outage — especially one that overlapped an upload, approve, or archive request — can
leave the database and storage backend disagreeing (an object moved but the DB update didn't land,
or vice versa; `media.service.ts`'s own compensation logic handles the common case, but isn't
infallible against a hard process kill mid-operation).

```bash
pnpm media:reconcile           # dry-run, read-only — see docs/media-pipeline.md for what it checks
pnpm media:reconcile -- --json # machine-readable, for scripting/comparison
```

Any `error`-severity finding here → go to `docs/runbooks/media-inconsistency.md` before considering
the incident closed.

## Validation

- `curl -s https://<api-host>/api/v1/health/ready` returns `200`, `storage: true`.
- `pnpm media:reconcile` reports no `error`-severity findings.
- A real upload → approve → public-fetch round trip succeeds (manually, or via
  `apps/api/test/portrait-cv.api.integration.test.ts`-style verification in staging).

## Data-loss risk

Storage being unreachable does not itself lose data (objects already written remain wherever they
are). Risk is introduced only by acting on incomplete information during the outage — e.g.
re-uploading something assumed lost that actually still exists. Always run `media:reconcile` before
taking any corrective action, not just after.

## Must not do

- Do not run `pnpm media:reconcile -- --repair --yes` while storage is still unreachable — every
  repair action itself requires storage access and will simply fail or report inconsistent
  results; wait until readiness reports `storage: true` first.
- Do not create a new bucket/local path with the same name as a quick fix without confirming
  whether the original still has recoverable objects.

## Post-incident checks

- `pnpm media:reconcile` clean (no error findings).
- Spot-check the active CV, portrait, and a recently-published project's evidence images all load
  publicly.
