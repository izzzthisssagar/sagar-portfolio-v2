#!/usr/bin/env bash
# End-to-end PostgreSQL backup/restore rehearsal, meant to run standalone as a single CI step:
# seed disposable content, back it up, restore into a fresh scratch database, verify the restore,
# confirm Prisma itself considers the restored schema healthy, spot-check a known relationship,
# then clean up. See docs/backup-restore.md.
#
# Assumes $DATABASE_URL already points at a clean, already-migrated database (the caller's/CI's
# job to arrange, e.g. via `prisma migrate deploy` against a fresh database — never
# `prisma migrate reset`). This script never runs a destructive operation against the database
# named in $DATABASE_URL: it only reads from it, backs it up, and adds disposable seed/fixture
# rows to it. All restore/verify activity happens in separately-named scratch databases that this
# script creates and drops itself.
#
# Env vars:
#   KEEP_BACKUP=true   Keep the .dump file this run produces instead of deleting it at the end
#                       (default: deleted — see docs/backup-restore.md for the rationale).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${DATABASE_URL:?DATABASE_URL must be set and point at a clean, already-migrated database.}"

DB_URL_HELPER="$REPO_ROOT/scripts/lib/db-url.mjs"
KEEP_BACKUP="${KEEP_BACKUP:-false}"

BACKUP_FILE=""
SCRATCH_DB=""

cleanup() {
  status=$?
  echo ""
  echo "--- cleanup ---"
  if [ -n "$SCRATCH_DB" ]; then
    MAINT_URL="$(node "$DB_URL_HELPER" maintenance "$DATABASE_URL")"
    psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -q -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$SCRATCH_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
    if psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1; then
      echo "Dropped scratch database: $SCRATCH_DB"
    else
      echo "WARNING: could not drop scratch database $SCRATCH_DB — drop it manually." >&2
    fi
  fi
  if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    if [ "$KEEP_BACKUP" = "true" ]; then
      echo "Kept rehearsal backup file (KEEP_BACKUP=true): $BACKUP_FILE"
    else
      rm -f "$BACKUP_FILE"
      echo "Removed rehearsal backup file: $BACKUP_FILE"
    fi
  fi
  if [ "$status" -eq 0 ]; then
    echo "--- backup/restore rehearsal: ALL PASSED ---"
  else
    echo "--- backup/restore rehearsal: FAILED ---" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

echo "=== step 1/7: confirming the source database is already migrated ==="
pnpm exec prisma migrate status

echo ""
echo "=== step 2/7: seeding disposable CMS content (pnpm db:seed) ==="
pnpm db:seed

echo ""
echo "=== step 3/7: seeding Sprint 3 rehearsal fixtures (media, CV, contact delivery) ==="
pnpm exec tsx "$REPO_ROOT/scripts/db-rehearsal-fixtures.ts"

echo ""
echo "=== step 4/7: backing up ==="
BACKUP_OUTPUT="$(bash "$REPO_ROOT/scripts/db-backup.sh" | tee /dev/stderr)"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^RESULT_BACKUP_FILE=//p' | tail -n1)"
[ -n "$BACKUP_FILE" ] || {
  echo "Could not determine the backup file path from scripts/db-backup.sh output." >&2
  exit 1
}

echo ""
echo "=== step 5/7: restoring into a fresh scratch database and verifying ==="
VERIFY_OUTPUT="$(bash "$REPO_ROOT/scripts/db-verify-backup.sh" "$BACKUP_FILE" --keep | tee /dev/stderr)"
SCRATCH_DB="$(printf '%s\n' "$VERIFY_OUTPUT" | sed -n 's/^RESULT_SCRATCH_DB=//p' | tail -n1)"
[ -n "$SCRATCH_DB" ] || {
  echo "Could not determine the scratch database name from scripts/db-verify-backup.sh output." >&2
  exit 1
}

RESTORED_URL="$(node "$DB_URL_HELPER" with-db "$DATABASE_URL" "$SCRATCH_DB")"

echo ""
echo "=== step 6/7: confirming Prisma considers the restored schema healthy ==="
DATABASE_URL="$RESTORED_URL" pnpm exec prisma migrate status

echo ""
echo "=== step 7/7: spot-checking known relationships in the restored database ==="
sql() { psql "$RESTORED_URL" --no-password -v ON_ERROR_STOP=1 -tAc "$1"; }

QA_STATUS="$(sql "SELECT status FROM \"Project\" WHERE slug = 'qa-mastery'")"
[ "$QA_STATUS" = "PUBLISHED" ] || {
  echo "FAIL: qa-mastery project missing or not PUBLISHED in the restored database (got '$QA_STATUS')" >&2
  exit 1
}

QA_METRICS="$(sql "SELECT count(*) FROM \"ProjectMetric\" pm JOIN \"Project\" p ON p.id = pm.\"projectId\" WHERE p.slug = 'qa-mastery' AND pm.evidence = 'CONFIRMED'")"
[ "$QA_METRICS" = "4" ] || {
  echo "FAIL: expected 4 CONFIRMED metrics on qa-mastery in the restored database, got $QA_METRICS" >&2
  exit 1
}

FIELD_NOTES="$(sql "SELECT count(*) FROM \"BlogPost\" bp JOIN \"BlogCategory\" bc ON bc.id = bp.\"categoryId\" WHERE bc.slug = 'field-notes'")"
[ "$FIELD_NOTES" = "4" ] || {
  echo "FAIL: expected 4 Field Notes posts in the restored database, got $FIELD_NOTES" >&2
  exit 1
}

CV_LINK="$(sql "SELECT count(*) FROM \"CvDocument\" cv JOIN \"MediaAsset\" m ON m.id = cv.\"mediaId\" WHERE cv.active = true")"
[ "$CV_LINK" = "1" ] || {
  echo "FAIL: expected exactly 1 active CvDocument correctly joined to its MediaAsset in the restored database, got $CV_LINK" >&2
  exit 1
}

echo "PASS: qa-mastery is PUBLISHED with 4 confirmed metrics; 4 Field Notes posts present; exactly 1 active CV correctly linked to its media asset."
