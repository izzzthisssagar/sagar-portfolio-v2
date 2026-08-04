#!/usr/bin/env bash
# Dumps $DATABASE_URL to a timestamped pg_dump custom-format (-Fc) file under backups/ at the
# repo root. Custom format is Postgres's recommended format for pg_restore compatibility and
# built-in compression (vs. plain-SQL -Fp). See docs/backup-restore.md.
#
# Never prints the database password: pg_dump is given the full connection string directly
# (via scripts/lib/db-url.mjs, which only strips Prisma-only query params — never splits the URL
# apart or echoes its pieces). Only a credential-free "redacted" form (host/port/db) is ever
# printed.
#
# Contract for callers (e.g. scripts/backup-restore-rehearsal.sh): the last line of stdout is
# always `RESULT_BACKUP_FILE=<path>`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${DATABASE_URL:?DATABASE_URL must be set (see .env.example).}"

DB_URL_HELPER="$REPO_ROOT/scripts/lib/db-url.mjs"
BACKUP_DIR="$REPO_ROOT/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
OUTPUT="$BACKUP_DIR/sagar-portfolio-${TIMESTAMP}.dump"

REDACTED="$(node "$DB_URL_HELPER" redact "$DATABASE_URL")"
echo "--- backing up $REDACTED ---"

# libpq (not raw $DATABASE_URL): strips Prisma-only query params (e.g. ?schema=public) that
# pg_dump rejects outright ("invalid URI query parameter") but Prisma itself relies on.
LIBPQ_URL="$(node "$DB_URL_HELPER" libpq "$DATABASE_URL")"
pg_dump "$LIBPQ_URL" -Fc --no-password -f "$OUTPUT"

SIZE="$(du -h "$OUTPUT" | cut -f1 | tr -d '[:space:]')"
echo "Backup written: $OUTPUT ($SIZE)"
echo "RESULT_BACKUP_FILE=$OUTPUT"
