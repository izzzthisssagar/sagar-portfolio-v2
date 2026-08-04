# Runbook: failed migration

## Symptoms

- `prisma migrate deploy` exits non-zero during a deployment.
- `prisma migrate status` reports a migration in a `failed` state, or drift (applied migrations on
  the database don't match what the codebase expects).

## Immediate containment

- **Do not run `prisma migrate deploy` again immediately** — retrying blind against a database in
  an unknown partial state can make things worse. Diagnose first.
- **Do not shift traffic to the new application version** if migrations haven't cleanly completed —
  the old version should keep serving (this is exactly why `docs/deployment.md`'s migration
  sequence runs migrations as a separate step _before_ shifting traffic, not as part of the
  deploy-and-go).

## Diagnosis

```bash
pnpm exec prisma migrate status
```

Three broad cases, and they need different responses:

1. **The migration never started applying** (connectivity/permissions error before any SQL ran) —
   this is really `docs/runbooks/database-unavailable.md`'s territory; fix connectivity/permissions
   and retry `migrate deploy` once confirmed healthy.
2. **The migration started but failed partway** (`migrate status` shows it as applied-but-failed) —
   the database is now in a state Prisma itself flags as needing manual resolution. Read the actual
   SQL error from the failed run's output before touching anything — it tells you whether the
   partial DDL is a problem (e.g. a `CREATE INDEX` that only half-completed) or harmless (e.g. it
   failed on a step that's naturally idempotent to retry).
3. **Drift** — the database has migrations applied that the codebase's migration history doesn't
   know about (or vice versa) — almost always means someone ran a migration by hand, or two
   deployments raced. Do not run `migrate deploy` against drifted state without understanding
   exactly what's different; `prisma migrate diff` (against the two migration histories) is the
   tool for seeing precisely what disagrees.

## Safe recovery

**If the failure is clearly recoverable in place** (e.g. failed on a step that's safe to retry, no
partial destructive DDL committed): fix the underlying cause (bad SQL, insufficient DB permissions,
a lock held by something else) and re-run `prisma migrate deploy`.

**If the migration applied destructively and partially** (e.g. it dropped a column and then failed
on the next statement) — this is a genuine "prefer restore over forward-fix" case:

1. `pnpm db:backup` against the _current_, broken state first — even broken, don't lose the ability
   to forensically inspect what happened.
2. Restore the last known-good pre-migration backup into a scratch database
   (`pnpm db:restore -- <backup> --target-db recovery_check`) and confirm it's actually good
   (`pnpm db:verify-backup`) before touching production.
3. Only once confirmed: `pnpm db:restore -- <backup> --replace-source` against the real production
   `DATABASE_URL` (see `docs/backup-restore.md` — this requires typed confirmation and is the one
   genuinely destructive command in this repo's own tooling).
4. Fix the migration itself (the SQL that failed) before attempting it again against the restored
   database.

**There are no down-migrations to run** — Prisma doesn't generate them for this project, and
hand-writing one for a migration that already destroyed data would just be a second destructive
operation pretending to be safe. See `docs/deployment.md` ("Rollback and version compatibility").

## Validation

- `prisma migrate status` reports every migration applied, none failed, no drift.
- `curl .../health/ready` returns `200` with `database: true`.
- `pnpm smoke:deployment` passes against the environment the migration targeted.

## Rollback / escalation point

If recovery requires restoring from backup, that _is_ the rollback — there's no separate rollback
step beyond it. If the restored backup itself turns out to be missing recent data the business
can't afford to lose, that's the point to stop and get explicit sign-off before proceeding (this
runbook can't make that call generically).

## Data-loss risk

**High**, specifically in the "migration applied destructively and partially" path — any data
written between the last backup and the failed migration is lost on restore. This is exactly why
`docs/deployment.md`'s migration sequence backs up immediately before running migrations, and why
this runbook's step 1 backs up the broken state too (so at least the failure itself is
forensically preserved, even if not restorable).

## Must not do

- Do not hand-edit the `_prisma_migrations` table to mark a failed migration as applied without
  actually reconciling the schema — this makes Prisma's own state tracking lie to itself and every
  future `migrate deploy` from that point on operates on false information.
- Do not run `prisma migrate reset` against production under any circumstances — it drops and
  recreates the entire schema.
- Do not skip step 1 (backing up the broken state) even though it feels redundant when things are
  already broken — it's cheap insurance against needing to understand exactly what happened later.

## Post-incident checks

- Confirm the migration that failed is fixed (its SQL corrected) before it's ever attempted again,
  in a lower environment first.
- Note whether the failure was environment-specific (a permissions gap only present in production)
  or would have failed anywhere — the latter should have been caught by CI's own
  `prisma migrate deploy` step against a fresh database; if it wasn't, that's a real CI gap worth
  closing.
