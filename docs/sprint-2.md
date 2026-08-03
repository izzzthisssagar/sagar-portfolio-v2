# Sprint 2 — CMS Content and Authentication

## Goal

Build a usable single-administrator authentication system and project CMS, then connect the
public project pages to PostgreSQL-backed content. By the end of Sprint 2 the administrator can
create the first account, sign in, stay signed in through refresh rotation, sign out and revoke
sessions, create/edit/publish/archive projects with metrics and findings, preview drafts, and see
published projects on the public site with live dashboard statistics.

## In scope

- Administrator provisioning command (`pnpm admin:create`), single administrator only, no public
  registration.
- Real authentication vertical: login, refresh (rotating), logout, logout-all, session lookup.
- CSRF and same-origin protection for cookie-authenticated state-changing requests.
- CMS login page, session-aware CMS shell, top bar with logout / revoke-all.
- Project CMS: list, create, edit, preview, publish/unpublish/archive, delete.
- `ProjectMetric` and `ProjectFinding` CRUD, nested under the project editor.
- Explicit publication workflow with validation and draft preview.
- Database-backed public `/work` and `/work/[slug]` (static seed data retired for projects).
- Idempotent development content seed: QA Mastery (review-ready, confirmed metrics) and Numazu
  Halal Food (draft, pending evidence).
- CMS dashboard backed by live database counts.
- Consistent API error envelope and Swagger coverage for every new endpoint.
- Unit, API integration (PostgreSQL), and Playwright coverage for all of the above.
- CI updated to provision Postgres, run the new suites, and provision a disposable test
  administrator.

## Explicitly out of scope (later sprints)

- Blog / Field Notes CMS.
- Media upload pipeline (uploads stay `QUARANTINED`/manual; no new upload UI).
- Contact-message email delivery.
- Final GLB production assets or final scroll choreography.
- Playable QA Rift / Phaser gameplay (the game-engine package stays pure logic).

## What Sprint 1 already provided (not rebuilt)

- Next.js public site + CMS shell, NestJS versioned API, Prisma/PostgreSQL.
- Public/admin project route split (`/api/v1/projects*` vs `/api/v1/admin/projects*`), enforced
  published-only public access.
- `verifyAdminAccessToken` (jose) shared by the Next.js proxy middleware and CMS layout.
- `JwtAuthGuard` for the API, argon2 dependency, refresh-token hashing and lockout-math helpers
  already sitting in `AuthService` (`nextLoginFailure`, `canAttemptLogin`, `hashRefreshToken`).
- Prisma models for `AdminUser`, `RefreshSession`, `AuditLog`, `ProjectMetric`, `ProjectFinding`
  already defined in the schema — Sprint 2 wires them up, it does not invent them.
- Adaptive R3F scene, reduced-motion/poster fallback, Vitest/Playwright/axe/Postgres CI.

Sprint 2 extends this foundation. It does not replace the JWT verification boundary, the
public/admin route split, or the scene/quality system.

## Administrator provisioning

One administrator, created once via `pnpm admin:create` (see `docs/authentication.md`). No
self-registration endpoint exists or is planned. The command refuses to run a second time once an
administrator row exists.

## CMS data flow

Browser → (same-site, cross-origin) → NestJS API, authenticated via an `HttpOnly` access-token
cookie the API itself issues. Next.js Server Components needing CMS data server-side read that
same cookie and forward it as an `Authorization: Bearer` header to the API — one token, two
transports, one verification path. See `docs/authentication.md` for the full flow and
`docs/cms-content-model.md` for the project/metric/finding data model and publication rules.

## Known exclusions and assumptions

- **Same-site deployment assumption.** The cookie/CSRF design (`SameSite=Strict`, direct
  cross-origin browser→API calls) requires the web app and API to share a registrable domain
  (e.g. `app.example.com` / `api.example.com`, or same-origin via a reverse proxy). This already
  holds locally and in CI (`localhost:3000` / `localhost:4000` are same-site). A split-domain
  production deployment would need this design revisited — flagged here rather than silently
  assumed away.
- Media upload UI is not built; `MediaAsset` stays reachable only through the seed script for
  Sprint 2 evidence purposes.
- Blog (`BlogPost`) and game-content (`GameConfig`, `GameChallenge`, `GameAchievement`) CMS pages
  are not built this sprint — the dashboard reports zero/empty for those safely rather than
  fabricating figures.
- Contact messages are readable in the dashboard/CMS but no email delivery exists.
