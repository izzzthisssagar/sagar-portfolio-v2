# Production security posture

## Rate-limit policy

Global `ThrottlerGuard` (`APP_GUARD`), production default **60 requests / 60 seconds / IP**
(`apps/api/src/app.module.ts`). Per-route overrides, all using `@Throttle({ default: {...} })`
(the same named "default" throttler bucket — `@nestjs/throttler` tracks usage per
route+IP regardless of a shared bucket name, so a route-specific override changes only that
route's own budget, never anyone else's):

| Route                                                               | Budget                      | Rationale                                                                                                                                      |
| ------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`                                                  | 20/60s                      | Credential-stuffing/brute-force target — pre-existing, unchanged.                                                                              |
| `POST /auth/refresh`                                                | 30/60s                      | Token-rotation abuse target; generous enough for legitimate multi-tab browser refresh churn.                                                   |
| `POST /contact`                                                     | 20/60s                      | Spam target — pre-existing, unchanged.                                                                                                         |
| `POST /admin/media` (upload)                                        | 20/60s                      | Upload abuse; paired with the existing per-file `MEDIA_MAX_IMAGE_BYTES`/`MEDIA_MAX_PDF_BYTES` byte-size caps.                                  |
| `GET /health/*`                                                     | exempt (`@SkipThrottle()`)  | Orchestrator probe traffic, not user traffic — must never compete with real requests or get itself rate-limited into reporting a false outage. |
| Everything else (public reads, authenticated admin reads/mutations) | 60/60s (the global default) | No override yet — see Sprint 5 recommendations below.                                                                                          |

**CI-only override**: `RATE_LIMIT_MAX` (default 60, see `docs/runtime-configuration.md`) raises
only the _global default_ bucket for the one disposable API process CI/Playwright spawns —
route-specific overrides above (`20`, `30`) are literal numbers in each `@Throttle` decorator and
are never affected by `RATE_LIMIT_MAX`. A raised CI budget cannot loosen login/contact/upload's
own limits.

A `429` response includes a `Retry-After` header (set by `ThrottlerGuard` itself) and a clean,
non-implementation-leaking message ("Too many requests. Please try again later.") — the library's
own default message text literally names its internal exception class
(`"ThrottlerException: Too Many Requests"`), which `ErrorEnvelopeFilter` now replaces for every
429 regardless of which route triggered it.

**Sprint 5 candidate**: a distinct, higher budget for authenticated administrator reads (the
single-administrator CMS is legitimate, low-risk, potentially bursty traffic that currently
shares the same 60/60s budget as anonymous public reads) — deliberately not changed this sprint
since the task's own guidance made it optional ("may use a separate documented budget") and it
touches many controllers for uncertain benefit.

## Trusted proxy

`TRUST_PROXY` (`false` default, `1` the only other accepted value — see
`docs/runtime-configuration.md`) drives Express's own `trust proxy` setting directly
(`configure-app.ts`). Never inferred from `NODE_ENV` or anything else.

- **`false`** (default, no reverse proxy in front): `req.ip` reflects the direct TCP socket
  address only. Any `X-Forwarded-For` a client sends is ignored entirely — a client cannot spoof
  its own IP for rate-limiting or the contact-form IP hash (`hashIp()`, `auth.service.ts`).
- **`"1"`** (exactly one reverse proxy in front — the only topology this deployment documents
  support for): `req.ip` becomes the right-most entry of `X-Forwarded-For` that the trusted proxy
  itself appended (or the direct socket address if the proxy didn't set the header) — the
  client's real address, not the proxy's.

Deploying behind more than one hop (a CDN in front of a load balancer in front of the app, for
example) is **not currently supported** — `TRUST_PROXY` only expresses "trust zero hops" or
"trust exactly one hop." A multi-hop deployment needs this revisited before launch.

## Security headers (`apps/api/src/security-headers.ts`)

- **Content-Security-Policy**: `default-src 'none'` — every other directive is an explicit,
  narrow `'self'` (or `'none'`) grant, never a wildcard. This API serves JSON almost everywhere;
  the only HTML it ever serves is Swagger UI at `/docs`, which is not mounted in production at
  all (see below).
- **HSTS**: production only (`max-age=15552000; includeSubDomains`) — never claimed over a
  plaintext local HTTP server, which would be a lie about a guarantee the connection doesn't
  provide.
- **Referrer-Policy**: `no-referrer`.
- **Permissions-Policy**: camera/microphone/geolocation/payment/usb all denied
  (`interest-cohort=()` also, opting out of FLoC/Topics). Helmet 8 dropped
  `Permissions-Policy` support, so this is set directly rather than through helmet.
- **Cross-Origin-Resource-Policy**: `same-site` (not helmet's `same-origin` default) — the admin
  media preview `<img src>` loads cross-origin (web:3000 → api:4000, same site) and CORP is a
  separate, browser-enforced check that CORS headers alone don't satisfy.
- **X-Content-Type-Options**: `nosniff` (helmet default, unchanged).
- **Swagger UI (`/docs`)**: mounted in every environment except production
  (`apps/api/src/main.ts`) — an admin API's full route/schema map isn't something to expose at a
  public URL, and Swagger's own bundled inline script is incompatible with the strict
  `script-src` this CSP enforces everywhere else.

## CORS

Single-origin allowlist (`origin: env.WEB_URL, credentials: true`) — not a wildcard, not a
regex, not a dynamic per-request check. Matches the same-site cookie/CSRF design (`SameSite:
Strict`) Sprint 1–3 already established; this sprint didn't change it.

## Cookies (unchanged from Sprint 1–3, documented here for completeness)

`apps/api/src/auth/cookies.ts`: `sameSite: 'strict'`, `secure: NODE_ENV === 'production'`, no
`Domain` attribute (host-only — no cross-subdomain sharing is configured or claimed), `Path: '/'`
on all three cookies (`portfolio_access`, `portfolio_refresh`, `portfolio_csrf`) — deliberately
not narrowed to `/api/v1/auth`, since the Next.js proxy middleware needs the refresh cookie
attached on `/admin/*` requests to silently refresh an expired access token, and cookie-path
matching is exact-prefix, not "same site." `portfolio_access`/`portfolio_refresh` are `httpOnly`;
`portfolio_csrf` deliberately is not (it's a double-submit token, readable by client JS by design
— never a secret on its own).
