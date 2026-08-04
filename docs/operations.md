# Operations

Day-to-day operation of this system, and orientation for whoever is on call — which, for this
project, is just its single administrator. See `docs/incident-response.md` for "something's wrong,
start here" triage, and `docs/runbooks/*.md` for step-by-step recovery of specific failure modes.
This file is the index and the explanation of what the health endpoints and logs actually mean.

## Liveness vs. readiness

`apps/api/src/health/health.controller.ts` exposes two deliberately separate endpoints:

- **`GET /api/v1/health/live`** — `{ "status": "ok" }` whenever the process's own event loop is
  responsive. No dependency I/O at all (`HealthService.liveness()`, `apps/api/src/health/health.service.ts`).
  This is what an orchestrator's frequent, cheap "is the process still alive" probe should hit, and
  it's what both `Dockerfile.api`'s `HEALTHCHECK` and `scripts/container-smoke.sh` poll. It stays
  `200` during a PostgreSQL, storage, or SMTP outage on purpose — a liveness probe that depends on
  external services causes an orchestrator to kill and restart a perfectly healthy process during
  someone else's outage, which only makes the outage worse.
- **`GET /api/v1/health/ready`** — `200` with `{ ok: true, checks: [...] }` only when every
  dependency check passes; `503` with the same shape otherwise. `HealthService.readiness()` runs
  three checks in parallel:
  1. **`database`** — `SELECT 1` against PostgreSQL through Prisma.
  2. **`storage`** — the active `MediaStorageAdapter`'s `ping()` (a cheap reachability check: a
     writable-directory check for the local driver, a `HeadBucket` call for S3/MinIO — never an
     actual upload/download).
  3. **`notification-config`** — confirms the contact-notification configuration is _internally
     consistent_ (every SMTP field the selected driver needs is present), not that SMTP is
     currently reachable. A live SMTP outage does not fail this check — see
     `docs/runbooks/smtp-unavailable.md` for why that's a real gap and how to actually detect it.

  None of the three ever include a hostname, connection string, or stack trace in `detail` — only
  `"unavailable"` or `"incomplete configuration"`.

  Use readiness for anything that decides whether to route traffic to an instance: orchestrator
  readiness probes, `docker-compose.staging.yml`'s `condition: service_healthy` chains (which key
  off the same `HEALTHCHECK` directive in `Dockerfile.api`/`Dockerfile.web`), and
  `pnpm smoke:deployment`/`pnpm smoke:containers`.

- **`GET /api/v1/health/details`** — the same readiness result plus `service`/`releaseSha`, gated
  behind `HEALTH_INTERNAL_TOKEN` (`x-health-token` header). 404s, not 401/403, when the token is
  unset or wrong — an unauthenticated prober should not even be able to confirm the route exists.
  Useful for confirming exactly which release is live without exposing that to the public internet.

All three are exempt from rate limiting (`@SkipThrottle()` on `HealthController`) — probe traffic
must never compete with real requests for the same budget or get itself throttled into reporting a
false outage.

## Day-to-day commands

| Command                                                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm config:check`                                                | Validates `DATABASE_URL`, auth secrets, media/contact driver config, and every other env var against the zod schema (`apps/api/src/config/schema.ts`), for both the API and web app, without starting either. Never prints a secret value — only which field is invalid and why. Run this before any deploy and any time an env var changes.                                                                                                                             |
| `pnpm staging:up`                                                  | Brings up the full production-like rehearsal stack (`docker-compose.staging.yml`): real PostgreSQL, real MinIO, real Mailpit, and the actual production container images — never dev servers. Provisions `.env.staging` with fresh disposable secrets on first run, then runs `prisma migrate deploy` explicitly before starting the API.                                                                                                                                |
| `pnpm staging:down`                                                | Stops the staging stack (keeps volumes).                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm staging:logs [svc]`                                          | Tails logs for the staging stack, or one service (`pnpm staging:logs api`, `postgres`, `minio`, `mailpit`, `web`).                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm staging:smoke`                                               | Runs `scripts/deployment-smoke.mjs` (read-only checks — homepage, `/work`, `/notes`, `/contact`, sitemap/robots, full security-header set + HSTS-over-HTTPS, canonical link tag, parseable JSON-LD, health live/readiness, single project/post API responses cross-checked against the rendered web page to catch a silent static-fallback regression, CORS allowlist behavior, and that a 404 error envelope doesn't leak internals) against the running staging stack. |
| `pnpm staging:reset`                                               | **Destructive** — deletes the staging PostgreSQL/MinIO volumes and the `.env.staging` secrets. Prompts for confirmation. Staging-only; never touches production.                                                                                                                                                                                                                                                                                                         |
| `pnpm smoke:containers`                                            | Builds the production `Dockerfile.api`/`Dockerfile.web` images fresh and proves the deployability basics from scratch: both start, the API reaches a real throwaway PostgreSQL, health/homepage respond, and SIGTERM stops each container cleanly (exit 0, not a forced `SIGKILL`).                                                                                                                                                                                      |
| `pnpm smoke:deployment -- --base-url=<url> [--api-base-url=<url>]` | The same read-only smoke checks as `staging:smoke`, pointed at any running web+API deployment (staging or production). Never mutates data.                                                                                                                                                                                                                                                                                                                               |
| `pnpm exec prisma migrate status`                                  | Reports which migrations are applied/pending/failed against `DATABASE_URL` — the first thing to run when diagnosing a schema or connectivity problem.                                                                                                                                                                                                                                                                                                                    |

## Logs

`apps/api/src/logging/structured-logger.ts` emits one JSON object per log line in production
(`LOG_FORMAT` defaults to `json` in production, a compact human-readable line otherwise), always
including `timestamp`, `level`, `service` (`SERVICE_NAME`, default `portfolio-api`), `releaseSha`
(`RELEASE_SHA`, set to the deployed commit SHA in CI/containers), and `message`. Every call site's
extra fields are recursively redacted (`apps/api/src/logging/redact.ts`) before serialization — any
key matching `password|passwd|secret|token|authorization|cookie|smtp_|access_key|secret_key|
connectionstring|database_url|apikey|api_key` (case-insensitive) becomes `"[redacted]"` regardless
of nesting, so a new field added to a payload later doesn't need a matching redaction rule added by
hand. `LOG_LEVEL` (`debug`/`info`/`warn`/`error`, default `info`) filters what's emitted at all.

Every request gets an id (`apps/api/src/logging/request-id.ts`): a caller-supplied `x-request-id`
header is trusted if it looks safe (`^[A-Za-z0-9_-]{1,128}$`), otherwise a fresh UUID is generated.
It's echoed back on the response and attached to every structured log line for that request,
including the one access-log line every completed request produces
(`apps/api/src/logging/access-log.middleware.ts`, `message: "http_request"`, fields `requestId`,
`method`, `route` — the matched route template like `/api/v1/projects/:id`, not the raw path with a
real id in it — `statusCode`, `durationMs`). **This is the id to ask for when reporting or
investigating an issue** — `scripts/deployment-smoke.mjs` sets one on its own liveness check
specifically so it can be grepped for afterward.

What to grep for:

- `grep '"message":"http_request"'` — every request/response pair, with status and duration.
- `grep '"statusCode":5'` — server errors.
- `grep '"level":"error"'` — everything the app itself flagged as an error, not just HTTP 5xx.
- `grep '"requestId":"<id>"'` — every log line for one specific request, once you have an id from a
  user report, a smoke-test failure, or `scripts/deployment-smoke.mjs --json`'s `requestId` field.
- `grep '"database"'` / `'"storage"'` / `'"notification-config"'` — readiness-check outcomes, if
  your log aggregator also captures readiness probe responses (it doesn't by default; readiness is
  a plain HTTP response, not a log line, unless you're logging the probe traffic itself).

## Incident scenarios

See `docs/incident-response.md` for how to pick the right one, and the individual runbooks under
`docs/runbooks/` for step-by-step diagnosis and recovery:

- `docs/runbooks/database-unavailable.md`
- `docs/runbooks/storage-unavailable.md`
- `docs/runbooks/smtp-unavailable.md`
- `docs/runbooks/authentication-incident.md`
- `docs/runbooks/media-inconsistency.md`
- `docs/runbooks/failed-migration.md`
- `docs/runbooks/rollback.md`
- `docs/runbooks/contact-spam.md`

## On-call orientation (single administrator)

There is no team, no rotation, and no pager here — this is one person's portfolio site. "On call"
means: you get an alert or notice something's wrong (most likely by visiting the site, checking
`staging:smoke`/`smoke:deployment` output, or noticing the admin inbox stopped getting mail), you
diagnose using the commands above and the relevant runbook, you fix it, and you note what happened
somewhere durable (this repo's docs, or wherever you track your own operational history) if it
revealed a gap worth closing later. There is no dashboard, alerting integration, or status page
provisioned by this repo — if you want one, that's a "set it up" decision, not something already
wired in.

Graceful shutdown (`apps/api/src/shutdown.ts`) matters operationally: SIGTERM/SIGINT trigger
`app.close()` (stop accepting new work, finish in-flight requests, run every `OnModuleDestroy` hook
including Prisma's disconnect), bounded by `SHUTDOWN_GRACE_PERIOD_MS` (default 10000ms) before a
forced `exit(1)`. This is why `Dockerfile.api`/`Dockerfile.web` run `node` directly as `CMD` rather
than through `npm`/`pnpm` — a package-manager wrapper is an extra process that would have to itself
forward the container runtime's SIGTERM, and `scripts/container-smoke.sh` explicitly asserts this
works (`docker stop -t 15` must exit `0`, not require a forced `SIGKILL`/exit `137`). If you ever
see a container that only stops via `SIGKILL`, that's a signal-propagation regression worth its own
investigation, not just "restart it and move on."
