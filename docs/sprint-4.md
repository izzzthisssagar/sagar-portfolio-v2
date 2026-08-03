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

This section is filled in as each phase completes.
