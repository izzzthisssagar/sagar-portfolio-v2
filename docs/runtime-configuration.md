# Runtime configuration

Centralized, validated configuration for the API lives in `apps/api/src/config/` (`schema.ts`
defines the zod schema per category; `index.ts` exposes `loadConfig`, `loadConfigOrThrow`,
`getConfig`, and `loadAdminProvisioningConfig`). Validate any environment without starting the
app:

```bash
pnpm config:check
```

Never prints a secret value — only which field is invalid and why. Exits non-zero on any
validation failure.

`apps/api/src/main.ts` calls `getConfig()` (which calls `loadConfigOrThrow()` once, memoized for
the process lifetime) before Nest, Prisma, or the HTTP listener start — a malformed environment
fails immediately with every problem listed, never a partially-started process.

Storage (`storage.module.ts`) and notification (`notification.module.ts`) driver selection keep
their own existing, already-tested fail-closed validation (unchanged from Sprint 3) rather than
being routed through the memoized `getConfig()` singleton — those factories are re-invoked fresh
per `Test.createTestingModule()` compile in the existing integration-test suite, which depends on
reading `process.env` at factory-call time, not once per process. The **rules** those factories
enforce are the same rules documented and tested in `apps/api/src/config/schema.ts`; there are
two enforcement sites for historical/testing reasons, not two different policies.

## Categories

### Core

| Variable       | Required            | Default                                 | Notes                                                             |
| -------------- | ------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `NODE_ENV`     | no                  | `development`                           | `development` \| `test` \| `production`                           |
| `DATABASE_URL` | **yes**             | —                                       | must start with `postgres`                                        |
| `WEB_URL`      | **production: yes** | `http://localhost:3000` (dev/test only) | must be a valid URL; expected browser Origin for CSRF enforcement |
| `API_URL`      | **production: yes** | — (dev/test: unset)                     | must be a valid URL; expected API Host for CSRF enforcement       |
| `PORT`         | no                  | `4000`                                  | 1–65535                                                           |

### Authentication

| Variable                 | Required | Notes                                                                                                                                          |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_TOKEN_SECRET`    | **yes**  | ≥32 chars, rejects the `replace-` placeholder                                                                                                  |
| `ACCESS_TOKEN_ISSUER`    | **yes**  | non-empty                                                                                                                                      |
| `ACCESS_TOKEN_AUDIENCE`  | **yes**  | non-empty                                                                                                                                      |
| `REFRESH_TOKEN_SECRET`   | **yes**  | ≥32 chars — validated for forward-compatibility; not currently read by refresh-token issuance (opaque DB-hashed tokens, see `auth.service.ts`) |
| `REFRESH_TOKEN_TTL_DAYS` | no       | default `7`, bounded 1–365                                                                                                                     |

### Administrator provisioning (CLI only — never required for the API server to boot)

| Variable         | Required (for `pnpm admin:create`) |
| ---------------- | ---------------------------------- |
| `ADMIN_EMAIL`    | yes, valid email                   |
| `ADMIN_PASSWORD` | yes                                |

### Media

| Variable                                                           | Required                  | Notes                                                 |
| ------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------- |
| `MEDIA_STORAGE_DRIVER`                                             | production only           | `local` \| `s3`; production must set `s3`             |
| `MEDIA_STORAGE_LOCAL_PATH`                                         | no                        | used when driver is `local`                           |
| `MEDIA_STORAGE_ENDPOINT`                                           | no                        | valid URL (S3-compatible custom endpoint, e.g. MinIO) |
| `MEDIA_STORAGE_REGION` / `_BUCKET` / `_ACCESS_KEY` / `_SECRET_KEY` | required when driver=`s3` |                                                       |
| `MEDIA_STORAGE_PUBLIC_BASE_URL`                                    | no                        | valid URL                                             |
| `MEDIA_MAX_IMAGE_BYTES`                                            | no                        | default 8 MiB, bounded 1 KiB–100 MiB                  |
| `MEDIA_MAX_PDF_BYTES`                                              | no                        | default 15 MiB, bounded 1 KiB–200 MiB                 |

### Contact delivery

| Variable                                                    | Required                    | Notes                                           |
| ----------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| `CONTACT_NOTIFICATION_DRIVER`                               | production only             | `capture` \| `smtp`; production must set `smtp` |
| `CONTACT_NOTIFICATION_TO`                                   | required when driver=`smtp` | valid email                                     |
| `SMTP_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `_FROM` | required when driver=`smtp` | `SMTP_PORT` 1–65535                             |
| `SMTP_SECURE`                                               | no                          | exactly `true` or `false`, default `false`      |

### Metrics

| Variable          | Required                             | Default | Notes                                                                                                                                                |
| ----------------- | ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `METRICS_ENABLED` | no                                   | `false` | exactly `true` or `false`; endpoint 404s whenever this is not `true`                                                                                 |
| `METRICS_TOKEN`   | required when `METRICS_ENABLED=true` | —       | ≥16 chars; presented token is compared via SHA-256 digest + `timingSafeEqual`, never as raw bytes — see `apps/api/src/metrics/metrics.controller.ts` |

### Operational

| Variable                   | Required | Default                              | Notes                                                                  |
| -------------------------- | -------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `RATE_LIMIT_MAX`           | no       | `60`                                 | bounded 1–100,000; CI-only override, see `docs/security-production.md` |
| `TRUST_PROXY`              | no       | `false`                              | `false` \| `1` — see `docs/security-production.md`                     |
| `LOG_LEVEL`                | no       | `info`                               | `debug` \| `info` \| `warn` \| `error`                                 |
| `LOG_FORMAT`               | no       | JSON in production, pretty otherwise | `json` \| `pretty`                                                     |
| `SERVICE_NAME`             | no       | `portfolio-api`                      | appears in every structured log line                                   |
| `RELEASE_SHA`              | no       | `unknown`                            | set to the deployed commit SHA in CI/containers                        |
| `HEALTH_INTERNAL_TOKEN`    | no       | —                                    | ≥16 chars when set; gates `/health/details`                            |
| `SHUTDOWN_GRACE_PERIOD_MS` | no       | `10000`                              | bounded 0–60,000                                                       |

### Web (Next.js) — separate from the API's config, see `apps/web/lib/env.ts`

| Variable                        | Required                                              | Notes                                                                                        |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`           | **yes** (build-time, inlined into the browser bundle) | valid URL — never put a secret in a `NEXT_PUBLIC_*` variable                                 |
| `PUBLIC_SITE_URL`               | production only                                       | fails closed at build/render time when unset in production (pre-existing, Sprint 3 behavior) |
| `WEB_URL`                       | no                                                    | default `http://localhost:3000`                                                              |
| `ALLOW_STATIC_CONTENT_FALLBACK` | no                                                    | `true`/`false`, default `false`; must stay `false` in CI/production                          |
| `API_URL`                       | no (server-only)                                      | used by the Next proxy/middleware for the silent-refresh call; never sent to the browser     |

## Design rules

- Secrets never appear in an error message, log line, or `config:check` output — only the field
  name and a static reason.
- Every numeric variable rejects zero, negative, non-numeric, and unreasonably large values
  (bounded, not just "positive").
- **Boolean variables are strict.** The `bool()` helper (`apps/api/src/config/schema.ts`) accepts
  only the exact strings `"true"`, `"false"`, or an unset value (which falls back to the
  documented default) — anything else (`TRUE`, `1`, `0`, `yes`, `no`, `tru`, an empty string, ...)
  fails validation with a field-specific error rather than silently coercing to `false`. Applies
  to `SMTP_SECURE` and `METRICS_ENABLED`.
- **`WEB_URL` and `API_URL` are required and validated whenever `NODE_ENV=production`.** Production
  never falls back to `http://localhost:3000` for `WEB_URL`, and never boots without `API_URL` —
  both fail closed with a clear error at startup (`loadConfigOrThrow`/`config:check`) rather than
  silently degrading CSRF protection. `CsrfGuard` (`apps/api/src/auth/csrf.guard.ts`) reads these
  from the validated config layer, not raw `process.env`: `WEB_URL` is the expected browser
  `Origin`, `API_URL`'s host is the expected `Host` header. Outside production, both keep their
  documented dev/test defaults/fallbacks (`API_URL` unset means Host enforcement is skipped,
  which is what lets in-process Supertest integration tests hit an ephemeral host without being
  mistaken for the real API).
- Production-only requirements (`MEDIA_STORAGE_DRIVER=s3`, `CONTACT_NOTIFICATION_DRIVER=smtp`,
  `WEB_URL`/`API_URL`) apply **only** when `NODE_ENV=production` — CI and local development
  explicitly do not set `NODE_ENV=production`, so they keep the local/capture fallbacks without
  needing every production secret.
- `RATE_LIMIT_MAX` still defaults to `60` — the same production number Sprint 3 shipped. Only CI's
  own disposable API process (started by `playwright.config.ts` / `.github/workflows/ci.yml`)
  raises it, to 300 — see `docs/security-production.md` for why, and for the route-specific
  policy layered on top that a raised global CI number cannot bypass.
