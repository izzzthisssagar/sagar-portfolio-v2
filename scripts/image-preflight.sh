#!/usr/bin/env bash
# Validates that every pinned infrastructure image (scripts/lib/pinned-images.sh) can actually be
# pulled, before CI/staging/smoke spend time building on top of them. Run manually with
# `pnpm images:preflight`; CI runs it as the first step of both the verify and containers jobs so
# a dead pin fails fast with a clear message instead of surfacing as a confusing service-container
# or `docker run` timeout.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=lib/pinned-images.sh
source scripts/lib/pinned-images.sh

images=("$POSTGRES_IMAGE" "$MINIO_SERVER_IMAGE" "$MINIO_CLIENT_IMAGE" "$MAILPIT_IMAGE")

failed=0
for image in "${images[@]}"; do
  echo "--- pulling $image ---"
  if docker pull "$image" >/dev/null; then
    echo "OK: $image"
  else
    echo "FAIL: could not pull $image" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "One or more pinned images could not be pulled — see failures above." >&2
  exit 1
fi

echo "--- image preflight: ALL PINNED IMAGES PULLABLE ---"
