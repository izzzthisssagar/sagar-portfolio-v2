# Database backup and restore

PostgreSQL backup, restore, and a scripted rehearsal that exercises the whole cycle end to end.
Covers `pnpm db:backup`, `pnpm db:restore`, `pnpm db:verify-backup`, and
`pnpm db:backup-restore-rehearsal`.

## Format

`scripts/db-backup.sh` calls `pg_dump "$DATABASE_URL" -Fc` — Postgres's custom archive format
(`-Fc`), not plain SQL (`-Fp`). Custom format is compressed, restorable with `pg_restore`
(supports `--clean --if-exists` object-by-object replay, table/schema filtering, and parallel
restore), and is the format the project's own `pg_restore`-based restore path expects. Output
lands in `backups/<name>-<UTC timestamp>.dump` — `backups/` is git-ignored (see `.gitignore`);
a real database dump must never be committed.

## Never prints credentials

Every script hands `$DATABASE_URL` straight to `pg_dump`/`pg_restore`/`psql`/`createdb` as a
connection string — none of them parse it apart and echo the pieces. The only thing ever printed
is a redacted form (`scripts/lib/db-url.mjs redact`): `postgresql://host:port/dbname` with no
user, password, or query-string credentials. `scripts/lib/db-url.mjs` is the single place that
parses `DATABASE_URL`; every `db-*.sh` script sources it for `dbname` / `redact` / `with-db` /
`maintenance` (the last needed because `CREATE DATABASE` / `DROP DATABASE` can't run against the
database you're connected to — they run against Postgres's own `postgres` maintenance database).

## Commands

### `pnpm db:backup`

Dumps `$DATABASE_URL` to a new timestamped file under `backups/`. Prints the redacted source and,
as its last line, `RESULT_BACKUP_FILE=<path>` — the contract other scripts parse to chain steps.

### `pnpm db:restore -- <backup-file> [--target-db NAME] [--replace-source]`

**Default is safe by construction**: restores into `<source-db>_restore` (or `--target-db NAME`),
never into the database named in `DATABASE_URL`. The script refuses to run if the resolved target
equals the source database. Creates the target database first if it doesn't exist; uses
`pg_restore --clean --if-exists --no-owner --no-privileges` so restoring twice into the same
target is safe and role/ownership mismatches between the dump's origin and the restoring role
don't produce noisy (if non-fatal) errors.

**`--replace-source` is the one destructive path**: it restores _over_ the database named in
`DATABASE_URL`, and only that path exists for it — there is no way to target an arbitrary
production database by name, only "the one `DATABASE_URL` already points at." It prints an
explicit warning and requires typing `restore` at a prompt; anything else aborts with no changes.
This is for genuine emergency recovery (see `docs/runbooks/failed-migration.md`), never for a
routine rehearsal.

### `pnpm db:verify-backup -- <backup-file> [--keep]`

Restores the backup into a fresh, disposable `sagar_portfolio_verify_<timestamp>` database (via
`db-restore.sh`), runs verification queries, and drops the scratch database on exit (`--keep`
leaves it for manual inspection). Hard checks (non-zero exit on failure):

- `_prisma_migrations` table exists and has rows (migration history survived the dump/restore).
- The `CvDocument_one_active_key` partial unique index (`(active) WHERE active = true` — the
  single-active-CV constraint from migration `20260803090512_cv_document_single_active_constraint`)
  is present in the restored schema.
- At most one `CvDocument` row has `active = true` in the restored data.

Informational (printed, not a failure): row counts for `Project`, `BlogPost`, `ContactMessage`,
`ContactDeliveryAttempt`, `MediaAsset`, `CvDocument`, `AdminUser`, `RefreshSession`, with a `WARN`
if any of these is unexpectedly empty — for a human to sanity-check against the source, not an
automated pass/fail (a legitimately empty table, e.g. no `RefreshSession` rows because nobody is
currently logged in, is not a backup defect).

### `pnpm db:backup-restore-rehearsal`

The full CI rehearsal, matching the sprint's required sequence:

1. `prisma migrate status` — confirm the source database is already migrated (this script never
   runs `prisma migrate reset` or any destructive operation against `$DATABASE_URL`).
2. `pnpm db:seed` — the real CMS content seed (`prisma/seed-content.ts`).
3. `scripts/db-rehearsal-fixtures.ts` — adds representative Sprint 3 rows the content seed doesn't
   create: three `MediaAsset` rows across `APPROVED`/`QUARANTINED`/`REJECTED`, one active
   `CvDocument` linked to its media, and a `ContactMessage` with a `ContactDeliveryAttempt`. Every
   fixture row is tagged with a `rehearsal-fixture` marker and deleted-then-recreated on each run
   (idempotent — re-running never accumulates duplicates). Deliberately does **not** create an
   `AdminUser` or `RefreshSession` — a restore rehearsal must never normalize seeding fake admin
   credentials or sessions into any database.
4. `db-backup.sh` — back up the now-fixtured source database.
5. `db-verify-backup.sh --keep` — restore into a scratch database and run the checks above; kept
   (not dropped) so step 7 can query it.
6. `DATABASE_URL=<restored> prisma migrate status` — confirm Prisma itself considers the restored
   schema healthy, not just the raw SQL checks above.
7. Spot-check real relationships survived correctly: the `qa-mastery` project is `PUBLISHED` with
   exactly 4 `CONFIRMED` `ProjectMetric` rows (matches `prisma/seed-content.ts`'s four confirmed
   metrics), exactly 4 Field Notes posts exist (matches the four articles in
   `fieldNotesArticles`), and exactly one `CvDocument` is `active` and correctly joined to its
   `MediaAsset`.

Cleanup (`trap cleanup EXIT`, runs on success _or_ failure): terminates any remaining connections
to and drops the scratch database, and deletes the rehearsal's own backup file unless
`KEEP_BACKUP=true` is set. Exits non-zero — with `--- backup/restore rehearsal: FAILED ---` on
stderr — if any step fails.

## What's explicitly not restored / not part of the rehearsal

- **`AdminUser` and `RefreshSession` rows are never fabricated by the rehearsal fixtures.** A
  restore rehearsal proves the data path works; it must not become a second, informal way to seed
  admin credentials or sessions into a database. Real backups (of a real database) still contain
  whatever `AdminUser`/`RefreshSession` rows that database actually had — those restore normally;
  it's only the _rehearsal fixture step_ that abstains from creating new ones.
- **Object storage (S3-compatible bucket contents) is not part of a database backup.** A restored
  database can reference `MediaAsset.storageKey` values whose objects no longer exist in the
  bucket the restore target points at (e.g. restoring into a different environment). Use
  `pnpm media:reconcile` after a restore to detect database rows pointing at missing objects — see
  `docs/media-pipeline.md` and the media reconciliation tooling.
- **A restore never touches the source database** unless `--replace-source` is explicitly passed
  and confirmed — routine restores and the rehearsal always target a separate, disposable
  database.

## Production restore procedure (emergency recovery)

See `docs/runbooks/failed-migration.md` and `docs/runbooks/rollback.md` for the decision tree
(forward-fix vs. restore) and the exact emergency sequence. In short: back up first even in an
incident (`pnpm db:backup` against the current, possibly-broken state, so the pre-recovery state
isn't lost either), then `pnpm db:restore -- <known-good-backup> --replace-source` only after the
application is confirmed stopped or in maintenance mode, then re-verify with
`pnpm db:verify-backup` run manually against the now-restored primary database's connection
string before resuming traffic.

## CI

`pnpm db:backup-restore-rehearsal` runs as its own CI job against the same disposable PostgreSQL
service container CI already uses for the test suite, after `prisma migrate deploy`. Backup
artifacts (real `.dump` files) are never uploaded as CI artifacts — the rehearsal deletes its own
backup file on exit (`KEEP_BACKUP` is not set in CI), and even the rehearsal's synthetic fixture
data is disposable, generated per-run, and dropped with the scratch database.
