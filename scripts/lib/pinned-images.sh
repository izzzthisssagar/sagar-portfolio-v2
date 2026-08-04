# Single source of truth for every infrastructure container image this repo pulls: CI
# (.github/workflows/ci.yml), the staging rehearsal stack (docker-compose.staging.yml), and the
# production-container smoke test (scripts/container-smoke.sh) all resolve to these exact
# tag@digest pins — never `:latest`, never three different versions of the same image in three
# places. See docs/deployment.md "Pinned infrastructure images" for how/when to roll these
# forward. Shell scripts `source` this file directly; the two YAML files (ci.yml,
# docker-compose.staging.yml) hardcode the identical strings because GitHub Actions `services:`
# and Compose can't source a shell file — grep this file's values against those to check drift.
#
# Every digest below is the multi-architecture manifest-list digest (not a single-platform
# manifest digest), so the same pin resolves correctly on GitHub's amd64 runners and on Apple
# Silicon (arm64) local development. Verified against the registry before being committed here —
# see the commit that introduced this file for the exact `curl`/registry-API commands used.

# PostgreSQL — same major/minor everywhere (CI, staging, container smoke, local dev compose.yaml)
# on purpose; there is no intentional version skew to document.
POSTGRES_IMAGE='postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193'

# MinIO server. minio/minio stopped publishing new public Docker Hub releases after
# RELEASE.2025-09-07T16-13-09Z (MinIO moved subsequent AGPLv3 community releases behind a login
# wall) — this is the newest tag Docker Hub actually serves as of the digests above being
# verified, and it is a real, currently-pullable release, not a stale/EOL pin.
MINIO_SERVER_IMAGE='minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e'

# MinIO client (`mc`) — used both to provision the test/staging/smoke bucket and, in CI, to
# verify it exists afterward.
MINIO_CLIENT_IMAGE='minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727'

# Mailpit — real SMTP protocol testing target (never a mock).
MAILPIT_IMAGE='axllent/mailpit:v1.30.6@sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d'
