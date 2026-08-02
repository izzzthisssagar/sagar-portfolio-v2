# Authentication

## Administrator provisioning

`pnpm admin:create` (`apps/api/scripts/admin-create.ts`) is the only way an administrator row is
created. It requires `ADMIN_EMAIL` and `DATABASE_URL`, reads the password from `ADMIN_PASSWORD`
(non-interactive/CI) or an unechoed terminal prompt, validates password strength
(`apps/api/src/auth/password-policy.ts`: 12+ characters and 3 of {lower, upper, digit, symbol}, or
a 20+ character passphrase), hashes with Argon2id, refuses to run once any `AdminUser` row exists,
and writes an `ADMIN_CREATED` audit event. It never prints the password or a hash. There is no
public registration endpoint and none is planned — single administrator, always.

## Login

`POST /api/v1/auth/login` — validates the payload, normalizes the email (trim + lowercase), looks
up the administrator, and verifies the Argon2id hash. On failure it always returns the same
`401 INVALID_CREDENTIALS` body, whether the email is unknown or the password is wrong (an
`argon2.verify` call runs against a constant dummy hash on the unknown-email path so the two cases
take comparable time). Failures increment `AdminUser.failedLoginCount`; the fifth consecutive
failure sets `lockedUntil` 15 minutes out (`MAX_LOGIN_FAILURES` / `LOCKOUT_MS` in
`auth.service.ts`) and further attempts return `423 ACCOUNT_LOCKED` until it elapses. A successful
login resets both counters. Every outcome (`LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGIN_LOCKED`) is
audited. The login route also carries a route-level throttle (`@Throttle`, 20/min) independent of
the account-level lockout, so the two defenses don't mask each other in tests or in front of a
shared NAT.

## Tokens

**Access token** — HS256 JWT, `sub` = administrator id, `role: admin`, issuer/audience validated,
15-minute (`ACCESS_TOKEN_SECONDS`) lifetime. `apps/api/src/auth/jwt-config.ts` is the single place
that loads and validates `ACCESS_TOKEN_SECRET` / `_ISSUER` / `_AUDIENCE`; a missing, short, or
placeholder (`replace-...`) secret makes it return `null`, and every caller (the API's
`JwtAuthGuard`, `AuthService`) fails closed rather than accepting an unverifiable token. The
Next.js server boundary (`apps/web/lib/admin-auth.server.ts`) re-implements the same checks with
`jose` because it runs on a different runtime (Edge middleware) — this is Sprint 1 architecture,
kept as-is.

**Refresh token** — a 48-byte random value (`AuthService.newRefreshToken`), never stored raw; only
its SHA-256 hash lives in `RefreshSession.tokenHash`. Refresh rotates on every use: the old
`RefreshSession` row is marked `revokedAt` + `replacedById`, a new row is created, in one
transaction. If a token whose session is already `revokedAt` is presented again — a replay of a
token that was already rotated — every active session for that administrator is revoked
(`REFRESH_REUSE_DETECTED` audit event) and the request is rejected: the whole family dies, not
just the reused token, on the assumption a stolen-and-rotated token means the family is
compromised. Refresh sessions live `REFRESH_TOKEN_TTL_DAYS` (default 7) days.

## Cookies

| Cookie              | Path           | HttpOnly | Contents                     |
| ------------------- | -------------- | -------- | ---------------------------- |
| `portfolio_access`  | `/`            | yes      | the access JWT               |
| `portfolio_refresh` | `/api/v1/auth` | yes      | the raw refresh token        |
| `portfolio_csrf`    | `/`            | **no**   | a random double-submit value |

All three are `SameSite=Strict`, `Secure` in production. `portfolio_csrf` is deliberately
JS-readable — double-submit tokens are not secrets, the cookie/header pairing is the defense (see
below). `logout`/`logout-all` clear all three.

The browser calls the NestJS API directly (cross-origin from the Next.js origin, same-site) using
`NEXT_PUBLIC_API_URL`; the cookie rides along because the deployment is same-site (see "Known
exclusions" in `sprint-2.md`). Next.js Server Components that need admin data at render time read
the same `portfolio_access` cookie server-side and forward it as `Authorization: Bearer` — one
token, two transports, one verification path (`JwtAuthGuard` accepts either). Nothing in client
JavaScript ever reads the access or refresh token.

## CSRF (`apps/api/src/auth/csrf.guard.ts`)

Applied to every state-changing route that can be reached with cookies: `refresh`, `logout`,
`logout-all`, and all mutating `/admin/*` routes. `login` uses the same guard with
`@SkipCsrfToken()` — pre-session there is no CSRF cookie yet, so only the Origin/Host check runs.

1. **Origin/Host validation** — if an `Origin` header is present it must equal `WEB_URL`; if
   `API_URL` is set, `Host` must match it too. Requests with no `Origin` header (curl, mobile
   clients, the test suite) are allowed through this step — real cross-site browser attacks always
   send `Origin` on state-changing requests, so this doesn't weaken the defense, it just avoids
   penalizing non-browser callers.
2. **Double-submit token** — for requests without an `Authorization: Bearer` header (i.e. relying
   on the ambient cookie), the `X-CSRF-Token` header must equal the `portfolio_csrf` cookie value.
   Bearer-authenticated requests skip this: a cross-site attacker cannot make a victim's browser
   send a header it doesn't already know, so bearer calls aren't CSRF-able the way cookies are.

`GET`/`HEAD`/`OPTIONS` never run either check.

## Session lifecycle endpoints

`GET /api/v1/auth/session` returns the administrator's email and a live count of active (not
revoked, not expired) `RefreshSession` rows — this backs the CMS top bar's session status and
"revoke all sessions" affordance.

## Known limits

Everything in `docs/sprint-2.md`'s "Known exclusions" section applies here too, in particular the
same-site deployment assumption the cookie design depends on.
