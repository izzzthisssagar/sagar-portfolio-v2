#!/usr/bin/env bash
# Restores a pg_dump custom-format backup. By DEFAULT this restores into a SEPARATE, freshly
# created database — never the database named in $DATABASE_URL — so an accidental
# `pnpm db:restore` can never clobber the working database. See docs/backup-restore.md.
#
# Never prints the database password: every pg_restore/psql/createdb invocation is given a full
# connection string built by scripts/lib/db-url.mjs, never split-apart-and-echoed components.
#
# Contract for callers (e.g. scripts/db-verify-backup.sh): the last line of stdout is always
# `RESULT_TARGET_DB=<name>`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${DATABASE_URL:?DATABASE_URL must be set (see .env.example).}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/db-restore.sh <backup-file> [--target-db NAME] [--replace-source]

  --target-db NAME   Restore into this database name instead of the default
                      "<source-db>_restore". The database is created if it doesn't exist.
  --replace-source    DANGEROUS: restore over the database named in $DATABASE_URL itself. Only
                      for genuine emergency recovery. Requires typed confirmation.

Without --replace-source, this script NEVER writes to the database named in $DATABASE_URL.
EOF
  exit 1
}

BACKUP_FILE=""
TARGET_DB=""
REPLACE_SOURCE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --target-db)
      [ $# -ge 2 ] || usage
      TARGET_DB="$2"
      shift 2
      ;;
    --replace-source)
      REPLACE_SOURCE=true
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

validate_db_name() {
  case "$1" in
    '' | *[!A-Za-z0-9_]*)
      echo "Invalid database name: '$1' (letters, digits, underscore only)." >&2
      exit 1
      ;;
  esac
}

DB_URL_HELPER="$REPO_ROOT/scripts/lib/db-url.mjs"
SOURCE_DB="$(node "$DB_URL_HELPER" dbname "$DATABASE_URL")"

if [ "$REPLACE_SOURCE" = true ]; then
  if [ -n "$TARGET_DB" ] && [ "$TARGET_DB" != "$SOURCE_DB" ]; then
    echo "--target-db and --replace-source are mutually exclusive (--replace-source always targets the source database)." >&2
    exit 1
  fi
  TARGET_DB="$SOURCE_DB"
  TARGET_URL="$DATABASE_URL"

  echo "!!! DESTRUCTIVE: this restores '$BACKUP_FILE' OVER the database named in \$DATABASE_URL ('$SOURCE_DB'), replacing all of its current data. !!!"
  echo "Only do this for genuine emergency recovery — never for a routine rehearsal or test."
  read -r -p "Type 'restore' to continue: " confirmation
  if [ "$confirmation" != "restore" ]; then
    echo "Aborted — no changes made."
    exit 1
  fi
else
  if [ -z "$TARGET_DB" ]; then
    TARGET_DB="${SOURCE_DB}_restore"
  fi
  validate_db_name "$TARGET_DB"

  if [ "$TARGET_DB" = "$SOURCE_DB" ]; then
    echo "Refusing: --target-db resolved to the same database as \$DATABASE_URL ('$SOURCE_DB')." >&2
    echo "Pass --replace-source if you explicitly intend to restore over the source database." >&2
    exit 1
  fi

  TARGET_URL="$(node "$DB_URL_HELPER" with-db "$DATABASE_URL" "$TARGET_DB")"
  MAINT_URL="$(node "$DB_URL_HELPER" maintenance "$DATABASE_URL")"

  echo "--- ensuring target database '$TARGET_DB' exists (never touching '$SOURCE_DB') ---"
  EXISTS="$(psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"
  if [ "$EXISTS" != "1" ]; then
    psql "$MAINT_URL" --no-password -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$TARGET_DB\""
  fi
fi

REDACTED_TARGET="$(node "$DB_URL_HELPER" redact "$TARGET_URL")"
echo "--- restoring $BACKUP_FILE into $REDACTED_TARGET ---"

# --clean --if-exists: drop existing objects before recreating them (a safe no-op against an
#   empty database; essential for --replace-source, where the target already has objects).
# --no-owner --no-privileges: the dump records the original database role as object owner and in
#   GRANT/REVOKE statements. The role connecting here (from $DATABASE_URL / --target-db) may not
#   be that same role, or that role may not even exist in this cluster — without these flags,
#   pg_restore would emit (non-fatal, but noisy and easy to miss) errors on every ALTER ... OWNER
#   TO / GRANT statement it can't satisfy. With them, restored objects are simply owned by
#   whichever role performs the restore, which is the correct behavior for a restore into a
#   different/scratch database anyway.
pg_restore \
  --no-password \
  --clean --if-exists \
  --no-owner --no-privileges \
  --dbname="$TARGET_URL" \
  "$BACKUP_FILE"

echo "Restore complete: $TARGET_DB"
echo "RESULT_TARGET_DB=$TARGET_DB"
