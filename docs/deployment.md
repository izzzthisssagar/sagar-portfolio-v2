# Deployment

## Topology

Two independent, separately-deployed processes — never one monolith:

- **API** (`apps/api`, NestJS + Prisma) — the JSON API and admin surface. Built by `Dockerfile.api`
  into a non-root, production-only image (`docs/security-production.md` covers its runtime
  security posture). Depends on PostgreSQL, an S3-compatible object store, and an SMTP relay.
- **Web** (`apps/web`, Next.js) — the public site and CMS UI, server-rendered. Built by
  `Dockerfile.web` using Next's `output: 'standalone'` mode. Depends on the API only (no direct
  database or storage access).

Both are stateless — neither holds data the other process, or a restart, can't reconstruct from
PostgreSQL and object storage. This is what makes rolling deploys and horizontal scaling possible
without a shared-session or sticky-routing story.

A reverse proxy / load balancer terminating TLS sits in front of both in any real deployment (this
repo doesn't prescribe or configure a specific one — see "Proxy and TLS assumptions" below).
`TRUST_PROXY=1` (`docs/security-production.md`) assumes exactly one such hop.

## Application dependencies

| Dependency          | Required in production                   | Notes                                                                                                                                             |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL          | yes                                      | `DATABASE_URL`. Readiness-checked (`/api/v1/health/ready`).                                                                                       |
| S3-compatible store | yes (`MEDIA_STORAGE_DRIVER=s3`)          | Real AWS S3 or any S3-compatible provider. MinIO is used for local/staging rehearsal and CI protocol testing only — see `docs/media-pipeline.md`. |
| SMTP relay          | yes (`CONTACT_NOTIFICATION_DRIVER=smtp`) | Any real SMTP provider. Mailpit is used for local/staging/CI protocol testing only — see `docs/contact-delivery.md`.                              |

See `docs/runtime-configuration.md` for the complete required/optional environment variable
reference — this doc doesn't repeat it.

## Container builds

`Dockerfile.api` and `Dockerfile.web` are multi-stage, produce non-root runtime images, and are
deliberately buildable **without** a live backend:

- The API image copies the Prisma-generated client explicitly into the deployed tree (pnpm's
  virtual store layout leaves it behind under a plain `pnpm deploy --prod` otherwise — see the
  comment in `Dockerfile.api` for the exact mechanism) and excludes test files from the compiled
  output (`apps/api/tsconfig.build.json`).
- The web image's build stage allows the static-content fallback (`ALLOW_STATIC_CONTENT_FALLBACK=true`,
  scoped to that one `RUN` step only, never the runtime stage) because `/sitemap.xml`, `/work`,
  and `/notes` are statically prerendered and fetch their listing data at build time, with no live
  API reachable inside the Docker build — confirmed by actually building without it: `next build`
  fails outright (`PublicContentUnavailableError` on `/sitemap.xml`). Every fetch in
  `lib/public-content.server.ts` uses `next: { revalidate: 60 }`, so real content replaces the
  placeholder within 60 seconds of traffic in any real deployment. `work/[slug]` and
  `notes/[slug]` are unaffected by this flag either way — they have no `generateStaticParams` at
  all, because they read the per-request CSP nonce (`headers()`), which Next.js does not allow
  combining with static generation for the same route (see the comment in
  `apps/web/app/work/[slug]/page.tsx` — found by actually building and serving a real production
  build; the dev server every e2e/unit test runs against doesn't hit this path).
- Both images ship a `HEALTHCHECK` (plain Node `fetch`, since the alpine base has neither `curl`
  nor `wget`) so orchestrators — and `docker-compose.staging.yml`'s
  `condition: service_healthy` dependency ordering — have something real to probe.
- **Migrations are never run inside the image build or as an implicit container-startup step** —
  see "Migration sequence" below.

Build them from the repo root:

```bash
docker build -f Dockerfile.api -t portfolio-api \
  --build-arg RELEASE_SHA="$(git rev-parse HEAD)" .
docker build -f Dockerfile.web -t portfolio-web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 \
  --build-arg PUBLIC_SITE_URL=https://example.com \
  --build-arg RELEASE_SHA="$(git rev-parse HEAD)" .
```

`pnpm smoke:containers` (`scripts/container-smoke.sh`) builds both images and proves the basics
that make an image deployable: both start, the API reaches a real PostgreSQL, health/homepage
respond, and SIGTERM stops each container cleanly (exit 0) rather than requiring a SIGKILL.

### Pinned infrastructure images

Every infrastructure image this repo pulls — PostgreSQL, the MinIO server, the MinIO client
(`mc`), Mailpit — is pinned to an exact `tag@digest`, never `:latest`, and is the _same_ pin in
`.github/workflows/ci.yml`, `docker-compose.staging.yml`, and `scripts/container-smoke.sh`.
`scripts/lib/pinned-images.sh` is the single source of truth those shell-based consumers `source`
directly; the two YAML files hardcode the identical strings (YAML can't source a shell file) —
grep that file's values against those two if you suspect drift. `pnpm images:preflight`
(`scripts/image-preflight.sh`) pulls all four and fails fast with a clear message if any pin has
gone stale, rather than that surfacing later as a confusing service-container or `docker run`
timeout. Every digest pinned is the multi-architecture manifest-list digest, so the same pin
resolves correctly on GitHub's amd64 runners and on Apple Silicon (arm64) local development.

## Staging: a production-like local rehearsal

`docker-compose.staging.yml` runs the actual production images against real PostgreSQL, real
MinIO (as the S3-compatible backend), and real Mailpit (SMTP capture/inspection) — never dev
servers, never the local-storage or capture-notification fallback drivers. This is the closest
thing to "deploy it and see" available without a real hosting target or production credentials.

```bash
pnpm staging:up      # provisions .env.staging (gitignored, random secrets) on first run, brings
                      # the stack up healthy, runs `prisma migrate deploy` explicitly before the
                      # API starts
pnpm staging:smoke    # protocol-level checks against the running stack (scripts/deployment-smoke.mjs)
pnpm staging:logs
pnpm staging:down     # stop, keep data
pnpm staging:reset    # DESTRUCTIVE — requires typing "reset" — drops volumes and the generated secrets
```

See `scripts/staging.sh` for the exact sequencing. Seed content is never loaded automatically —
run `pnpm db:seed` against the staging `DATABASE_URL` if demo content is wanted.

## Migration sequence

Migrations are **never** implicit — not baked into the image build, not run automatically on
container startup. The deployment sequence is:

1. **Back up** the production database (`pnpm db:backup` — see `docs/backup-restore.md`).
2. **Deploy the new application version** (new container images), but do not yet shift traffic to
   it — or ensure the new version is migration-compatible with the still-running old version if
   deploying in place (see "Rollback and version compatibility" below).
3. **Run migrations explicitly**: `pnpm exec prisma migrate deploy` against the production
   `DATABASE_URL`, from a context with network access to the database but not necessarily running
   the API itself (a CI job step, a one-off task, or an operator's machine — this repo doesn't
   prescribe which, since that depends on the real hosting target chosen).
4. **Verify readiness**: `curl -f https://<api-host>/api/v1/health/ready` returns `200` and
   `{"ok":true}` with every dependency check passing.
5. **Shift traffic** to the new version (however the real deployment target does this — DNS,
   load-balancer target group, platform-specific release step).
6. **Run smoke tests**: `pnpm smoke:deployment -- --base-url=https://example.com` (see
   `scripts/deployment-smoke.mjs`) — read-only checks against the live, traffic-serving
   deployment.

`pnpm exec prisma migrate status` reports drift (a migration applied out of order, or a database
that's ahead of what the deployed code expects) — run it as a pre-flight check before step 3 in
any deployment where you're not 100% certain of the database's current migration state.

## Rollback and version compatibility

- **Prefer a forward fix over a rollback** whenever the failure is in application code and the
  database schema is unaffected — redeploying a fixed version is safer and faster than reversing
  a migration.
- **Prisma migrations in this repo have no down-migrations** — Prisma doesn't generate them, and
  hand-writing fake ones for a migration that can't safely be reversed (e.g. one that dropped a
  column) would be actively dangerous, silently discarding data on "rollback." A schema rollback,
  when genuinely needed, means restoring from a pre-migration backup (`docs/backup-restore.md`),
  not reversing forward.
- **Old-app-version / new-schema compatibility**: because migrations run as an explicit step
  separate from traffic shifting (see above), there is a window where the still-running old
  application version must tolerate the new schema. This repo's migrations are additive in the
  common case (new nullable columns, new tables) specifically so the previous app version keeps
  working unmodified against the post-migration schema during that window. A migration that
  removes or renames a column the old version still reads would break this — check migration
  content against what the _currently deployed_ version reads before running it during a
  no-downtime deploy, not just what the _new_ version needs.
- **When a database restore is the only option**: a migration that already ran destructively
  against production data (not just failed to complete — actually applied and lost/corrupted
  data) with no way to reconstruct the lost state from the application layer. See
  `docs/runbooks/failed-migration.md` and `docs/runbooks/rollback.md` for the concrete decision
  tree and commands.

## Proxy and TLS assumptions

This repo does not configure or prescribe a specific reverse proxy or TLS terminator — that choice
depends on the real hosting target, which hasn't been chosen (see "Known limitations" below).
What it does assume, and what any real deployment must satisfy:

- Exactly one trusted reverse-proxy hop in front of the API (`TRUST_PROXY=1`) — see
  `docs/security-production.md` for why "trust every hop" or "trust none" are both wrong defaults.
- TLS terminates at that proxy; the API and web containers themselves speak plain HTTP internally.
  HSTS and `upgrade-insecure-requests` are only ever sent when `NODE_ENV=production` — never a
  false guarantee over a connection that isn't actually HTTPS end-to-end from the browser's
  perspective.
- The proxy forwards `X-Forwarded-For` and `Host` correctly — the CSRF guard's Origin/Host
  validation (`apps/api/src/auth/csrf.guard.ts`) depends on `Host` being the real external host,
  not an internal container hostname.

## Cookie assumptions

Documented in full in `docs/security-production.md` ("Cookies") — this doc only notes the
deployment-relevant consequence: `WEB_URL` and `API_URL` must be set to the real public origins in
production (not `localhost`), since cookie `Secure`/`SameSite` behavior and CORS/CSRF origin
checks are derived from them.

## Known limitations

- **No real hosting target chosen.** This sprint builds and rehearses the deployment mechanics
  (containers, staging stack, migration sequence, smoke tests) without picking or configuring a
  specific cloud platform, PaaS, or bare-metal target — per this sprint's explicit scope, choosing
  a production deployment target requires user input this repo doesn't have. Whatever target is
  eventually chosen needs to satisfy: runs the two container images, provides a reachable
  PostgreSQL, provides (or points at) an S3-compatible bucket and SMTP relay, and terminates TLS
  in front of both.
- **No production S3/SMTP credentials.** Every protocol-level test in this sprint (media storage,
  contact notification) runs against MinIO/Mailpit — real S3-compatible and SMTP _protocol_
  verification, never verification against a specific real production provider. See
  `docs/media-pipeline.md` and `docs/contact-delivery.md`.
- **No CI wiring for the staging/backup rehearsal yet committed as of this doc being written** —
  the scripts are built and manually verified end-to-end; `.github/workflows/ci.yml` wiring is
  tracked separately in this sprint's plan.

## Production-launch checklist

Before pointing a real domain at a real deployment of this application:

- [ ] `pnpm config:check` passes against the real production environment variables (without
      starting the app) — see `docs/runtime-configuration.md`.
- [ ] `DATABASE_URL` points at a real, backed-up PostgreSQL instance.
- [ ] `MEDIA_STORAGE_DRIVER=s3` with real bucket credentials; `pnpm staging:smoke`-equivalent
      checks pass against the real bucket at least once before launch.
- [ ] `CONTACT_NOTIFICATION_DRIVER=smtp` with a real, tested SMTP relay.
- [ ] `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` are freshly generated, ≥32 random characters,
      never reused from any local/staging environment.
- [ ] `WEB_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `PUBLIC_SITE_URL` all point at the real public
      origins.
- [ ] `TRUST_PROXY` matches the real proxy topology (see above).
- [ ] `pnpm db:backup` produces a verified backup (`pnpm db:verify-backup`) before the first
      `prisma migrate deploy` against production data.
- [ ] `pnpm smoke:deployment -- --base-url=<real-url>` passes against the live deployment.
- [ ] Portrait and CV are either genuinely configured or knowingly left `NOT CONFIGURED` — see
      `docs/asset-activation.md`.
- [ ] An administrator account has been provisioned (`pnpm admin:create` against production) with
      a strong, unique password — never the value from any `.env.example`.
