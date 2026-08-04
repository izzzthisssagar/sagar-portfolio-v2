#!/usr/bin/env bash
# Operates the production-like local rehearsal stack (docker-compose.staging.yml). See
# docs/deployment.md. Invoked via the pnpm staging:* scripts, not directly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose --env-file .env.staging -f docker-compose.staging.yml -p portfolio-staging"
ENV_FILE=".env.staging"

random_hex() { openssl rand -hex "$1"; }

provision_env() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi
  echo "No $ENV_FILE found — creating one from .env.staging.example with fresh staging-only secrets."
  cp .env.staging.example "$ENV_FILE"
  # macOS/BSD sed requires -i '' ; GNU sed requires -i with no argument. Detect once.
  if sed --version >/dev/null 2>&1; then SED_INPLACE=(-i); else SED_INPLACE=(-i ''); fi
  sed "${SED_INPLACE[@]}" \
    -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(random_hex 16)/" \
    -e "s/^MINIO_ROOT_PASSWORD=.*/MINIO_ROOT_PASSWORD=$(random_hex 16)/" \
    -e "s/^ACCESS_TOKEN_SECRET=.*/ACCESS_TOKEN_SECRET=$(random_hex 32)/" \
    -e "s/^REFRESH_TOKEN_SECRET=.*/REFRESH_TOKEN_SECRET=$(random_hex 32)/" \
    "$ENV_FILE"
  echo "$ENV_FILE created. These secrets are for this disposable staging stack only — never reuse them for production."
}

cmd_up() {
  provision_env
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  echo "--- starting infrastructure (postgres, minio, mailpit) ---"
  $COMPOSE up -d --build postgres minio mailpit
  echo "--- waiting for postgres/minio health ---"
  $COMPOSE up -d --wait postgres minio

  echo "--- provisioning the MinIO staging bucket ---"
  $COMPOSE up minio-init # runs to completion (not detached) so the bucket exists before the API starts

  echo "--- running database migrations explicitly, before the API starts ---"
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public" \
    pnpm exec prisma migrate deploy

  echo "--- starting API and web (production images) ---"
  $COMPOSE up -d --build api web
  echo "--- waiting for API/web health ---"
  $COMPOSE up -d --wait api web

  echo ""
  echo "Staging stack is up:"
  echo "  web:      http://localhost:${WEB_PORT}"
  echo "  API:      http://localhost:${API_PORT}/api/v1/health/ready"
  echo "  Mailpit:  http://localhost:8025"
  echo "  Postgres: localhost:${POSTGRES_PORT} (staging only)"
  echo ""
  echo "Seed content is NOT loaded automatically. Run 'pnpm db:seed' (against the same"
  echo "DATABASE_URL above) if you want the demo project/notes content."
}

cmd_down() {
  $COMPOSE down
}

cmd_logs() {
  $COMPOSE logs -f "$@"
}

cmd_smoke() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "No $ENV_FILE found — run 'pnpm staging:up' first." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  node scripts/deployment-smoke.mjs --base-url="http://localhost:${WEB_PORT}" --api-base-url="http://localhost:${API_PORT}"
}

cmd_reset() {
  echo "!!! DESTRUCTIVE: this deletes the staging PostgreSQL and MinIO volumes (all staging data). !!!"
  echo "This only affects the disposable '$(basename "$REPO_ROOT")' staging stack, never production."
  read -r -p "Type 'reset' to continue: " confirmation
  if [ "$confirmation" != "reset" ]; then
    echo "Aborted — no changes made."
    exit 1
  fi
  $COMPOSE down -v
  rm -f "$ENV_FILE"
  echo "Staging stack and its volumes/secrets were removed. Run 'pnpm staging:up' to rebuild from scratch."
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  logs) shift; cmd_logs "$@" ;;
  smoke) cmd_smoke ;;
  reset) cmd_reset ;;
  *)
    echo "Usage: $0 {up|down|logs|smoke|reset}" >&2
    exit 1
    ;;
esac
