# Runbook: rollback

Covers reversing a deployment (bad application version) — not a destructive-migration recovery,
which is `docs/runbooks/failed-migration.md`. Read "Decision tree" first; most rollback situations
don't actually need a database restore.

## Decision tree

```
Is the currently-deployed application version causing the problem
(bugs, crashes, bad behavior) with the database schema itself unaffected?
│
├─ YES → Prefer a FORWARD FIX or a straight rollback to the previous
│        container image. No database action needed. See "Application-only
│        rollback" below.
│
└─ NO — the database schema/data itself is wrong or damaged
   │
   ├─ Caused by a migration that already ran destructively?
   │  → docs/runbooks/failed-migration.md (this is that runbook's territory,
   │    not this one's).
   │
   └─ Something else corrupted/lost data (not a migration)?
      → Restore from backup — docs/backup-restore.md "Production restore
        procedure". Back up the current (bad) state first regardless.
```

**Prefer a forward fix over any rollback whenever the failure is in application code and the
schema is fine** — redeploying a corrected version is faster and carries none of the
compatibility-window risk described below. Rollback (reverting to a previous container image) is
for when a fix isn't ready yet and the current version needs to stop serving traffic now.

## Application-only rollback (no database involved)

1. Confirm the previous application version is still compatible with the _current_ database
   schema — check what migrations ran between the previous version's release and now. This
   project's migrations are additive in the common case specifically so the previous version keeps
   working unmodified against the post-migration schema (`docs/deployment.md`) — but confirm this
   for the specific migrations involved before assuming it.
2. Redeploy the previous container image (`portfolio-api`/`portfolio-web`, tagged by the previous
   release's `RELEASE_SHA` — see `Dockerfile.api`/`Dockerfile.web`'s `--build-arg RELEASE_SHA`).
3. Verify: `curl .../health/ready` returns `200`; `GET /api/v1/health/details` (if
   `HEALTH_INTERNAL_TOKEN` is configured) confirms the `releaseSha` now matches the previous
   version.
4. Run `pnpm smoke:deployment -- --base-url=<url>` against the rolled-back deployment.

## If the previous version is NOT compatible with the current schema

This means a migration ran that the old code can't tolerate (e.g. it reads a column a later
migration removed). Rolling back the application alone will break it just as badly as the original
problem, differently. Options, in order of preference:

1. **Forward-fix instead** — if at all possible, this is almost always better than an
   incompatible rollback.
2. **Roll back the database too** — only if the migration itself is the actual problem, which
   makes this `docs/runbooks/failed-migration.md`'s territory (restore from a pre-migration
   backup), not a pure application rollback.

## Validation

- `curl .../health/ready` → `200`, all checks passing.
- `GET /api/v1/health/details` (if configured) confirms the expected `releaseSha`.
- `pnpm smoke:deployment -- --base-url=<url>` passes.
- Spot-check the specific behavior that motivated the rollback is actually gone.

## Data-loss risk

An application-only rollback: none. A rollback that also requires a database restore: see
`docs/backup-restore.md` and `docs/runbooks/failed-migration.md` — same risk profile as any
restore (data written after the restored backup's timestamp is lost).

## Must not do

- Do not roll back the application to a version incompatible with the current schema "just to see"
  — confirm compatibility first (step 1 above).
- Do not treat a rollback as a substitute for actually fixing the underlying bug — it buys time,
  it doesn't fix anything.

## Post-incident checks

- Confirm the rolled-back version is stable (no repeat of the original symptom) before considering
  the incident closed.
- Track the forward fix as real follow-up work — a rollback that never gets followed by a fix means
  the next deploy just reintroduces the same problem.
