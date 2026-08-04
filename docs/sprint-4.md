# Sprint 4 — production readiness

Starting commit: `ea5dc7904eece6653d52fef9cc34fb6e79b1e6c1` (Sprint 3 merge into `main`).
Branch: `build/sprint-4-production-readiness`. Draft PR into `main`, never merged during this
sprint.

## Boundaries

Sprint 4 does **not** touch:

- public factual portfolio content (except a genuine bug fix)
- final GLB asset production, advanced scroll choreography, playable QA Rift levels
- public user accounts, blog comments, newsletter subscriptions, visitor-tracking analytics
- a real production deployment, real production credentials, or a real hosting platform
- Sprint 1–3 authentication, CSRF, or media/evidence security boundaries (preserved, not
  rebuilt)

Sprint 4 does not fabricate: no invented Lighthouse scores, no invented monitoring data, no
claim that a mocked S3/SMTP integration was "real" — protocol-level testing here means MinIO and
Mailpit/MailHog over the network, not a mock, and is documented as such (not AWS S3 or a real
mail provider).

## Deployment topology (assumed, not provisioned)

```
                        ┌─────────────┐
  browser  ───HTTPS───▶ │  reverse    │  (TLS terminates here; not part of this repo)
                        │  proxy      │
                        └──────┬──────┘
                               │ HTTP, one trusted hop (TRUST_PROXY=1)
                 ┌─────────────┼─────────────┐
                 ▼                           ▼
          ┌─────────────┐             ┌─────────────┐
          │  web (Next) │──same-site──▶│  api (Nest) │
          └─────────────┘  cookies    └──────┬──────┘
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                 ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
                 │ PostgreSQL  │      │ S3-compatible │      │  SMTP relay  │
                 └─────────────┘      │    storage    │      └──────────────┘
                                      └──────────────┘
```

`web` and `api` are assumed same-site (e.g. `app.example.com` and `api.example.com`, or a path
split behind one proxy) — this is what the existing cookie (`SameSite=Strict`) and CORS
(single-origin, `credentials: true`) design already requires; it is not new in Sprint 4.

## What Sprint 4 adds

See `docs/runtime-configuration.md`, `docs/deployment.md`, `docs/operations.md`,
`docs/backup-restore.md`, `docs/incident-response.md`, `docs/security-production.md`,
`docs/performance-release-gates.md`, and `docs/runbooks/*.md` for the detailed, per-topic
documentation. This file is the index and the scope record.

## Known pre-existing gaps this sprint intentionally does not "fix" by weakening anything

- `REFRESH_TOKEN_SECRET` and `ACCESS_TOKEN_TTL` are historical env vars that nothing in the
  running application reads (refresh tokens are opaque, database-hashed random values, not
  JWTs — see `apps/api/src/auth/auth.service.ts`; the access-token TTL is a hardcoded constant in
  `token-lifetimes.ts`). Sprint 4's config schema validates `REFRESH_TOKEN_SECRET`'s format for
  forward-compatibility and because it's set everywhere already, but does not invent a new
  consumer for it just to make it "used."
- The production rate-limit default stays 60 requests/60s/IP globally, with route-specific
  policies layered on top (see `docs/security-production.md`) — Sprint 3's CI-only
  `RATE_LIMIT_MAX` override is preserved exactly as-is and does not change production behavior.

## Real vs. deferred (updated as work lands — see the final Sprint 4 report for the authoritative

account of what shipped)

**Real** (verified by actually running it, not just reviewed): centralized config validation
(`pnpm config:check`); liveness/readiness/details health endpoints with graceful shutdown; JSON
structured logging with recursive redaction and request-id correlation; security headers, CORS,
trusted-proxy handling, and route-aware rate limits; production `Dockerfile.api`/`Dockerfile.web`
plus the `docker-compose.staging.yml` staging stack; `scripts/deployment-smoke.mjs` (canonical
link, JSON-LD, full header set, CORS, static-fallback cross-check); database backup/restore/
rehearsal (`pnpm db:backup*`) against a real local PostgreSQL; media reconciliation
(`pnpm media:reconcile`) against real MinIO; retryable contact-notification delivery; real
S3-compatible protocol testing against MinIO (`s3-storage.adapter.integration.test.ts`); real SMTP
protocol testing against Mailpit (`smtp-notification.adapter.integration.test.ts`); local secret
scanning (`pnpm secret-scan`, gitleaks) and dependency audit (`pnpm dependency-audit`); CI wiring
for all of the above (MinIO and Mailpit service containers, a separate container-build-and-smoke
job); an accessibility sweep across the three required viewports and all required flows
(`tests/e2e/accessibility.spec.ts`); real Lighthouse measurements against a real production build
for all six required pages (`docs/performance-release-gates.md`). Two real production bugs were
found and fixed in the process (see that doc and `docs/deployment.md`): a CSP-nonce-vs-static-
generation conflict that 500'd or silently CSP-blocked every framework script on every statically
rendered page, and a duplicate legacy health controller shadowing the real readiness endpoint.

**Deferred / not done this session**: Lighthouse is not yet wired into CI as an automated gate
(documented as a Sprint 5 candidate); no container-image vulnerability scan or SBOM generation;
no Prometheus-style `/metrics` endpoint; no real S3/SMTP production credentials or hosting target
(none supplied, per this sprint's explicit constraints); portrait and CV remain intentionally NOT
CONFIGURED (`docs/asset-activation.md`).
