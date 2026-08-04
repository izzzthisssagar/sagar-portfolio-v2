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
  policies layered on top (see `docs/security-production.md`) — the CI-only `RATE_LIMIT_MAX`
  override (raised further this sprint, 300 → 2000, to give the now-61-spec suite real headroom;
  see "E2E rate-limit headroom" below) is preserved exactly as the same narrow mechanism it always
  was and does not change production behavior. `apps/api/test/rate-limit-e2e-override.api.
integration.test.ts` proves this directly: a raised `RATE_LIMIT_MAX` lifts the _default_ budget
  but never the strict per-route policies (login, refresh, contact, media upload).

## E2E rate-limit headroom

The suite grew from 25 to 61 Playwright specs over Sprint 3/4 without its login-route request
volume being re-examined — the CI-only global `RATE_LIMIT_MAX` override was raised (60 → 300 in
Sprint 3) to cover the _global_ default budget, but several spec files (`cms-media.spec.ts`,
`cms-posts.spec.ts`, `cms-project-evidence.spec.ts`, `cms-projects.spec.ts`, `contact.spec.ts`)
each called the real UI login fresh per test, rather than sharing one real session the way
`accessibility.spec.ts` already did — pushing the whole suite's cumulative real-login count past
20 within a single rolling 60s window on `/api/v1/auth/login`'s own strict, deliberately-never-
raised budget. That is what actually produced the previously-reported flaky "59/61" result, not a
single fixed bug. Fixed by moving every CRUD-only spec file onto the same shared-login-once
pattern (`tests/e2e/helpers.ts`'s `loginOnceAndCaptureCookies` / `useSharedSession`) — cms-auth.
spec.ts, which specifically tests login/logout mechanics, keeps its individual real logins and
stays comfortably under budget on its own. `RATE_LIMIT_MAX` was separately raised to 2000 (~6x
headroom over a measured single clean run's total of 299 API requests) purely so the _global_
default never becomes a second, unrelated failure mode as the suite continues to grow.

Fixing the login volume surfaced (by actually eliminating the login-throttle noise, not by
retrying past it) two further real, previously-masked bugs, both fixed in the same pass:

- **A CSS Grid "blowout" on the admin shell at 390px.** `.admin-shell`'s grid items
  (`.admin-nav`, `.admin-main`) never overrode their default `min-width: auto`, so any
  sufficiently wide, unshrinkable descendant silently forced the whole two-row grid — and the
  page — past the viewport at mobile width, rather than wrapping or scrolling internally. Fixed
  with the standard `min-width: 0` grid-item fix, plus wrapping every admin data table (dashboard
  audit log, messages, posts, projects) in a `.table-scroll` container so a table's own natural
  content width scrolls internally instead of blowing out its ancestor.
- **That new scroll container was itself an axe violation.** A `overflow-x: auto` region with no
  keyboard access (`scrollable-region-focusable`) — fixed with `role="region"`, an `aria-label`,
  and `tabIndex={0}` on each `.table-scroll` wrapper.

`pnpm test:e2e` is now deterministically 61/61 — verified across four consecutive clean local
runs, not a single lucky pass.

## Real vs. deferred (updated as work lands — see the final Sprint 4 report for the authoritative

account of what shipped)

**Real** (verified by actually running it, not just reviewed): centralized config validation
(`pnpm config:check`); liveness/readiness/details health endpoints with graceful shutdown; JSON
structured logging with recursive redaction and request-id correlation; security headers, CORS,
trusted-proxy handling, and route-aware rate limits; production `Dockerfile.api`/`Dockerfile.web`
plus the `docker-compose.staging.yml` staging stack, every infrastructure image pinned to a
verified `tag@digest` (`scripts/lib/pinned-images.sh`, `pnpm images:preflight`) instead of
`:latest`; `scripts/deployment-smoke.mjs` (canonical link, JSON-LD, full header set, CORS,
static-fallback cross-check); database backup/restore/rehearsal (`pnpm db:backup*`) against a real
local PostgreSQL; media reconciliation (`pnpm media:reconcile`) against real MinIO; retryable
contact-notification delivery; real S3-compatible protocol testing against MinIO
(`s3-storage.adapter.integration.test.ts`); real SMTP protocol testing against Mailpit
(`smtp-notification.adapter.integration.test.ts`); local secret scanning (`pnpm secret-scan`,
gitleaks) and dependency audit (`pnpm dependency-audit`); CI wiring for all of the above (MinIO
started as a real step with its documented `server /data --console-address :9001` invocation, not
a `services:` container, plus a Mailpit service container; a container-build-and-smoke job that
runs independently of `verify`, not gated behind it); an accessibility sweep across the three
required viewports and all required flows (`tests/e2e/accessibility.spec.ts`); a deterministic
61/61 Playwright suite (see "E2E rate-limit headroom" above); a real Lighthouse CI gate
(`pnpm lighthouse:ci`, wired into `.github/workflows/ci.yml`) enforcing the documented budgets
against a real production build and a real seeded database for all six required pages
(`docs/performance-release-gates.md`); a protected, Prometheus-format internal metrics endpoint
(`GET /api/v1/internal/metrics` — `apps/api/src/metrics/`) with a fail-closed config (invalid
`METRICS_ENABLED=true`/no-token configuration refuses to boot, in every environment, not only
production), a 404-not-401 disabled/wrong-token response, constant-time token comparison, and a
CI smoke check (`pnpm metrics:smoke`). At least four real production bugs were found and fixed in
the process (see `docs/performance-release-gates.md`, `docs/deployment.md`, and "E2E rate-limit
headroom" above): a CSP-nonce-vs-static-generation conflict that 500'd or silently CSP-blocked
every framework script on every statically rendered page; a duplicate legacy health controller
shadowing the real readiness endpoint; a CSS Grid "blowout" on the admin shell that broke every
admin data table at mobile width; and the login-throttle-volume root cause of the flaky "59/61"
Playwright result.

**Deferred / not done this session**: no container-image vulnerability scan or SBOM generation; no
real S3/SMTP production credentials or hosting target (none supplied, per this sprint's explicit
constraints); portrait and CV remain intentionally NOT CONFIGURED (`docs/asset-activation.md`).
