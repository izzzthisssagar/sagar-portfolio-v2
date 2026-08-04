# Runbook: authentication incident

Covers: suspected refresh-token theft/reuse, unexpected forced logouts, or a need to revoke
administrator access immediately (lost device, suspected credential compromise).

## Symptoms

- A legitimate session gets "invalid refresh token" / is logged out unexpectedly.
- `AuditLog` shows `login` events from an unfamiliar IP hash or at an unusual time.
- You suspect a device with a valid session (browser, saved token) is no longer trusted (lost,
  stolen, or the admin password itself may be compromised).

## How this system already protects itself (context before you act)

- Refresh tokens are opaque, database-hashed random values — never JWTs — stored per-session
  (`RefreshSession`) with a `tokenVersion`. `apps/api/src/auth/auth.service.ts` detects **reuse of
  a retired refresh token** automatically: if a token from an already-rotated generation is
  presented again, the server treats this as evidence of theft, bumps `AdminUser.tokenVersion`, and
  revokes every session in that compromised generation (`revokeFamilyAsReuse`) — this already
  happens without operator action.
- This means: if reuse is ever detected, the attacker's session is already dead by the time you're
  reading this runbook. Your job is to confirm that happened and decide whether _further_ action
  (e.g. a full logout-all, a password change) is warranted.

## Immediate containment

**Revoke every session immediately** (use this any time you're not sure a narrower response is
enough — it's the safe default):

```
POST /api/v1/auth/logout-all
```

Authenticated, called from the admin UI or directly. `AuthService.logoutAll` bumps
`AdminUser.tokenVersion` and revokes every `RefreshSession` for that admin — every existing access
token stops working (access tokens carry `tokenVersion` and are checked against the current value)
and every refresh token is invalidated. This is the single "kill everything, start clean" action;
there is no partial/single-device revoke exposed, by design — for a single-administrator system,
"was this session compromised?" uncertainty should default to revoking all of them.

## Diagnosis

```sql
-- Recent login/logout/reuse events (never contains passwords or tokens):
SELECT action, "actorId", "ipHash", "createdAt", metadata
FROM "AuditLog"
WHERE action IN (
  'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_LOCKED',
  'REFRESH_REUSE_DETECTED', 'STALE_REFRESH_REJECTED', 'TOKEN_REFRESHED',
  'LOGOUT', 'LOGOUT_ALL'
)
ORDER BY "createdAt" DESC LIMIT 30;

-- Currently-valid sessions:
SELECT id, "userId", "createdAt", "expiresAt", "revokedAt", "tokenVersion"
FROM "RefreshSession"
WHERE "revokedAt" IS NULL AND "expiresAt" > now();
```

(`apps/api/src/auth/auth.service.ts`'s `this.audit(...)` calls are the source of truth for this
action list.)

`ipHash` lets you confirm "was this login from a plausible IP" without ever storing or exposing the
raw IP (`docs/security-production.md`, `hashIp()`).

## Safe recovery

1. If reuse was auto-detected (an `AuditLog` entry for it exists), the compromised generation is
   already revoked — confirm with the `RefreshSession` query above that no session from that
   generation is still `revokedAt IS NULL`.
2. If you have any doubt beyond what auto-detection caught, call `logout-all` regardless — it's
   idempotent-safe to call even when nothing was actually compromised (worst case: you get logged
   out everywhere and log back in once).
3. **If the admin password itself may be known to an attacker** (not just a stolen token):
   provision a new password via `pnpm admin:create`-equivalent flow or the account's password-reset
   path (check current `AdminUser` model/`admin-provisioning.ts` for what's exposed — a password
   change should itself force `logout-all` as a side effect; if it doesn't, call `logout-all`
   separately immediately after).

## Validation

- The `RefreshSession` query above returns no rows for the compromised generation.
- Logging in again from the legitimate device succeeds and issues a fresh session.
- `AuditLog` shows the `LOGOUT_ALL` event you expect, with the right `actorId`.

## Rollback / escalation point

There's no "rollback" for a security revocation — it's a one-way, safe-by-default action. If
`logout-all` locks out the legitimate admin unexpectedly, that's the intended behavior (log back in
with the real password); it is not a bug to work around.

## Data-loss risk

None — this affects sessions and tokens only, never `ContactMessage`/`Project`/`BlogPost`/media
data.

## Must not do

- Do not attempt to manually delete/edit `RefreshSession` rows directly in the database as a
  substitute for `logout-all` — the application-level action also correctly bumps
  `tokenVersion` (which invalidates already-issued access tokens, not just refresh tokens); a raw
  `DELETE` on `RefreshSession` alone leaves currently-valid access tokens working until they
  naturally expire.
- Do not log or record the actual password or token values anywhere while investigating.

## Post-incident checks

- Confirm only the legitimate device has a valid session after recovery.
- If this was a genuine compromise (not a false positive), consider whether the credential was
  exposed via a channel worth addressing separately (phishing, a leaked `.env`, a shared device) —
  that's outside what a token-revocation runbook fixes.
