#!/usr/bin/env bash
# Restores a pg_dump backup into a fresh, disposable scratch database (via scripts/db-restore.sh)
# and runs verification queries against it: migration history is present, the CvDocument
# partial-unique-index (active=true) is intact, and row counts for key tables are reported for a
# human to sanity-check. Drops the scratch database when done, unless --keep is passed. Exits
# non-zero if any hard check fails. See docs/backup-restore.md.
#
# Contract for callers (e.g. scripts/backup-restore-rehearsal.sh): the last line of stdout is
# always `RESULT_SCRATCH_DB=<name>`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${DATABASE_URL:?DATABASE_URL must be set — used only to locate the PostgreSQL server; the database it names is never read from or written to.}"

usage() {
  echo "Usage: scripts/db-verify-backup.sh <backup-file> [--keep]" >&2
  exit 1
}

BACKUP_FILE=""
KEEP=false
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)
      KEEP=true
      shift
      ;;
    -h | --help) usage ;;
    *)
      if [ -z "$BACKUP_FILE" ]; then
        BACKUP_FILE="$1"
        shift
      else
        usage
      fi
      ;;
  esac
done
[ -n "$BACKUP_FILE" ] || usage
[ -f "$BACKUP_FILE" ] || {
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
}

DB_URL_HELPER="$REPO_ROOT/scripts/lib/db-url.mjs"
TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
SCRATCH_DB="sagar_portfolio_verify_${TIMESTAMP}"
TARGET_URL="$(node "$DB_URL_HELPER" with-db "$DATABASE_URL" "$SCRATCH_DB")"
MAINT_URL="$(node "$DB_URL_HELPER" maintenance "$DATABASE_URL")"

FAILED=false

cleanup() {
  if [ "$KEEP" = true ]; then
    echo "Keeping scratch database (--keep): $SCRATCH_DB"
    return
  fi
  echo "--- dropping scratch database $SCRATCH_DB ---"
  psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$SCRATCH_DB' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 \
    || echo "WARNING: could not drop scratch database $SCRATCH_DB — drop it manually." >&2
}
trap cleanup EXIT

echo "--- restoring $BACKUP_FILE into scratch database $SCRATCH_DB ---"
bash "$REPO_ROOT/scripts/db-restore.sh" "$BACKUP_FILE" --target-db "$SCRATCH_DB"

sql() { psql "$TARGET_URL" --no-password -v ON_ERROR_STOP=1 -tAc "$1"; }

check() {
  local label="$1" ok="$2"
  if [ "$ok" = "0" ]; then
    echo "PASS: $label"
  else
    echo "FAIL: $label"
    FAILED=true
  fi
}

echo ""
echo "--- schema/integrity checks ---"

MIGRATIONS_TABLE="$(sql "SELECT to_regclass('public.\"_prisma_migrations\"') IS NOT NULL")"
if [ "$MIGRATIONS_TABLE" = "t" ]; then
  MIGRATIONS_COUNT="$(sql 'SELECT count(*) FROM "_prisma_migrations"')"
  if [ "$MIGRATIONS_COUNT" -gt 0 ] 2>/dev/null; then
    check "_prisma_migrations table exists and has rows ($MIGRATIONS_COUNT)" 0
  else
    check "_prisma_migrations table exists but has 0 rows (migration history lost)" 1
  fi
else
  check "_prisma_migrations table exists" 1
fi

CV_INDEX_DEF="$(sql "SELECT indexdef FROM pg_indexes WHERE indexname = 'CvDocument_one_active_key'")"
case "$CV_INDEX_DEF" in
  *active*WHERE*) check "CvDocument partial-unique-index on (active) WHERE active=true is present" 0 ;;
  *) check "CvDocument partial-unique-index on (active) WHERE active=true is present" 1 ;;
esac

CV_ACTIVE_COUNT="$(sql 'SELECT count(*) FROM "CvDocument" WHERE active = true')"
if [ "$CV_ACTIVE_COUNT" -le 1 ] 2>/dev/null; then
  check "at most one CvDocument row has active=true (found $CV_ACTIVE_COUNT)" 0
else
  check "at most one CvDocument row has active=true (found $CV_ACTIVE_COUNT)" 1
fi

echo ""
echo "--- row counts (informational — sanity-check against the source database) ---"
for table in Project BlogPost ContactMessage ContactDeliveryAttempt MediaAsset CvDocument AdminUser RefreshSession; do
  count="$(sql "SELECT count(*) FROM \"$table\"")"
  printf '  %-24s %s\n' "$table" "$count"
  if [ "$count" = "0" ]; then
    echo "  WARN: $table is empty in the restored database — confirm this is expected for the source." >&2
  fi
done

echo ""
echo "RESULT_SCRATCH_DB=$SCRATCH_DB"

if [ "$FAILED" = true ]; then
  echo ""
  echo "--- verification: FAILED ---" >&2
  exit 1
fi
echo ""
echo "--- verification: ALL PASSED ---"
