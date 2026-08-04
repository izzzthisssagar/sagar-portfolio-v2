#!/usr/bin/env bash
# Builds the production API and web images and proves the basics that make an image deployable:
# both start, the API can reach a real PostgreSQL, health/homepage respond, and SIGTERM stops
# each container cleanly (exit code 0) rather than requiring a SIGKILL. See docs/deployment.md.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/pinned-images.sh
source scripts/lib/pinned-images.sh

NET="portfolio-smoke-net-$$"
PG="smoke-pg-$$"
MINIO="smoke-minio-$$"
MAILPIT="smoke-mailpit-$$"
API="smoke-api-$$"
WEB="smoke-web-$$"
API_PORT=14000
WEB_PORT=13000

cleanup() {
  echo "--- cleanup ---"
  docker rm -f "$API" "$WEB" "$PG" "$MINIO" "$MAILPIT" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  for container in "$PG" "$MINIO" "$MAILPIT" "$API" "$WEB"; do
    echo "--- docker logs $container (last 60 lines) ---" >&2
    docker logs "$container" 2>&1 | tail -60 || true
  done
  exit 1
}

echo "--- building images ---"
docker build -f Dockerfile.api -t portfolio-api:smoke . >/dev/null
docker build -f Dockerfile.web -t portfolio-web:smoke \
  --build-arg NEXT_PUBLIC_API_URL="http://localhost:${API_PORT}" \
  --build-arg PUBLIC_SITE_URL="http://localhost:${WEB_PORT}" . >/dev/null
# Dockerfile.api's own intermediate "migrate" stage already has the full workspace installed,
# the Prisma client generated, prisma/migrations copied in, and prisma.config.ts (needed by
# `migrate deploy` specifically, unlike `generate` — see Dockerfile.api) — tagging just that
# stage (a cache hit, since the `docker build` above just built through its "build" parent) gives
# a ready-made, self-contained way to run `prisma migrate deploy` against the smoke postgres
# without installing pnpm/node on the host or publishing postgres's port — matches this script's
# "needs nothing but Docker" contract.
docker build -f Dockerfile.api -t portfolio-api:smoke-migrate --target migrate . >/dev/null

echo "--- starting dependencies ---"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=portfolio_smoke \
  "$POSTGRES_IMAGE" >/dev/null
docker run -d --name "$MINIO" --network "$NET" \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  "$MINIO_SERVER_IMAGE" server /data --console-address :9001 >/dev/null
docker run -d --name "$MAILPIT" --network "$NET" "$MAILPIT_IMAGE" >/dev/null

# The official postgres image restarts itself once internally after its first-boot initdb (a
# real, well-documented behavior of its docker-entrypoint), so `pg_isready` can flip
# ready -> not-ready -> ready again in that window. A single successful check right as that
# restart begins is not trustworthy — require 3 consecutive successful checks, 1s apart, before
# treating postgres as actually, stably ready.
consecutive_ready=0
for i in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; then
    consecutive_ready=$((consecutive_ready + 1))
    [ "$consecutive_ready" -ge 3 ] && break
  else
    consecutive_ready=0
  fi
  sleep 1
done
[ "$consecutive_ready" -ge 3 ] || fail "postgres did not become stably ready"

echo "--- running database migrations against the smoke postgres ---"
# The prisma *binary* directly (node_modules/.bin/prisma, a real symlink pnpm already created for
# this root-level devDependency during the image's own `pnpm install`), not `pnpm exec prisma` —
# `pnpm exec` runs its own dependency-status check first and, against this Docker layer's
# copied-in node_modules, decided a reinstall was needed; with CI=true (skipping the interactive
# purge-confirmation it otherwise blocks on) it actually ran one, and that reinstall left the
# workspace in a broken state ("Command \"prisma\" not found") rather than fixing anything.
# node_modules/.bin/prisma was always fine — no reinstall of a working, cache-hit image was ever
# actually necessary.
docker run --rm --network "$NET" \
  -e DATABASE_URL="postgresql://postgres:postgres@${PG}:5432/portfolio_smoke" \
  portfolio-api:smoke-migrate \
  ./node_modules/.bin/prisma migrate deploy || fail "database migration failed"

docker run --rm --network "$NET" --entrypoint sh "$MINIO_CLIENT_IMAGE" -c "
  mc alias set local http://${MINIO}:9000 minioadmin minioadmin &&
  mc mb local/portfolio-media-smoke
" >/dev/null || fail "could not provision the MinIO smoke bucket"

echo "--- starting API container ---"
docker run -d --name "$API" --network "$NET" -p "${API_PORT}:4000" \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://postgres:postgres@${PG}:5432/portfolio_smoke" \
  -e ACCESS_TOKEN_SECRET="smoke-test-access-token-secret-value-32chars" \
  -e ACCESS_TOKEN_ISSUER="portfolio-smoke" \
  -e ACCESS_TOKEN_AUDIENCE="portfolio-smoke" \
  -e REFRESH_TOKEN_SECRET="smoke-test-refresh-token-secret-value-32ch" \
  -e WEB_URL="http://localhost:${WEB_PORT}" \
  -e MEDIA_STORAGE_DRIVER="s3" \
  -e MEDIA_STORAGE_ENDPOINT="http://${MINIO}:9000" \
  -e MEDIA_STORAGE_REGION="us-east-1" \
  -e MEDIA_STORAGE_BUCKET="portfolio-media-smoke" \
  -e MEDIA_STORAGE_ACCESS_KEY="minioadmin" \
  -e MEDIA_STORAGE_SECRET_KEY="minioadmin" \
  -e MEDIA_STORAGE_PUBLIC_BASE_URL="http://localhost:${API_PORT}/media" \
  -e CONTACT_NOTIFICATION_DRIVER="smtp" \
  -e CONTACT_NOTIFICATION_TO="admin@example.com" \
  -e SMTP_HOST="${MAILPIT}" \
  -e SMTP_PORT="1025" \
  -e SMTP_SECURE="false" \
  -e SMTP_USERNAME="mailpit" \
  -e SMTP_PASSWORD="mailpit" \
  -e SMTP_FROM="noreply@example.com" \
  portfolio-api:smoke >/dev/null

for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${API_PORT}/api/v1/health/live" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || fail "API liveness did not return 200"
echo "API liveness: OK"

ready_body="$(curl -s "http://localhost:${API_PORT}/api/v1/health/ready")"
echo "$ready_body" | grep -q '"ok":true' || fail "API readiness reported not-ok: $ready_body"
echo "API readiness (PostgreSQL + MinIO + SMTP config): OK"

echo "--- starting web container ---"
docker run -d --name "$WEB" --network "$NET" -p "${WEB_PORT}:3000" \
  -e NODE_ENV=production \
  -e API_URL="http://${API}:4000" \
  -e PUBLIC_SITE_URL="http://localhost:${WEB_PORT}" \
  portfolio-web:smoke >/dev/null

for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done
[ "$code" = "200" ] || fail "web homepage did not return 200"
echo "web homepage: OK"

echo "--- graceful shutdown ---"
docker stop -t 15 "$API" >/dev/null
[ "$(docker inspect "$API" --format='{{.State.ExitCode}}')" = "0" ] || fail "API did not exit 0 on SIGTERM"
echo "API SIGTERM: exit 0"

docker stop -t 15 "$WEB" >/dev/null
web_exit="$(docker inspect "$WEB" --format='{{.State.ExitCode}}')"
# Next's standalone server has no custom SIGTERM handler — default Node disposition terminates
# the process on signal receipt (reported as 128+15=143), which is the expected/correct outcome
# here. What this test guards against is 137 (SIGKILL, meaning the signal never reached the
# process — e.g. a shell wrapper swallowed it and the container had to be force-killed).
[ "$web_exit" = "0" ] || [ "$web_exit" = "143" ] || fail "web container required SIGKILL (exit $web_exit) — signal was not propagated"
echo "web SIGTERM: exit $web_exit (signal propagated, no force-kill needed)"

echo "--- container smoke: ALL PASSED ---"
