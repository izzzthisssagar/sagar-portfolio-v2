# Contact message lifecycle and notification delivery

Status: **implemented** — persistence, honeypot/throttle protection, the capture (dev/test) and
SMTP (production, fail-closed) notification adapters, delivery-attempt tracking, the admin inbox,
and the public contact form are all live.

## Message lifecycle

`POST /api/v1/contact` (public, throttled) — persists first, notifies second. A message is never
lost because email delivery failed: the row is written inside its own transaction and committed
before any notification attempt starts; notification failure is recorded against the message, not
propagated as a failure of the submission itself.

Fields: `name`, `email` (normalized — trimmed, lowercased), `subject?`, `message`, `company?`
(optional, plain text), plus a hidden honeypot field that is never persisted — a filled honeypot
short-circuits to the same generic success response without writing a row, so a bot can't
distinguish "silently dropped" from "accepted" (avoids behavioral probing). Server-side validation
enforces size limits and rejects any HTML in `message`/`subject` (stored and later rendered as
plain text only, never `dangerouslySetInnerHTML`). The caller's IP is hashed
(`sha256(ip + pepper)`) before storage, matching the `AuditLog.ipHash` convention already used for
login attempts (`apps/api/src/auth/auth.service.ts`) — raw IPs are never persisted. A short
idempotency window (same normalized email + message hash within N minutes) collapses accidental
double-submits (e.g. a double form click) into a single stored message.

Statuses: `NEW` (renamed at the admin-UI layer to the spec's unread/read/replied/archived/spam via
an additional `ContactStatus` extension — see the schema note below) — admin actions: mark
read/unread, mark replied, archive, mark spam.

## Notification delivery

```ts
interface ContactNotificationAdapter {
  send(message: ContactMessageSummary): Promise<{ delivered: boolean; error?: string }>;
}
```

Adapters:

1. **Capture** (`CONTACT_NOTIFICATION_DRIVER=capture`) — default in development/test; records the
   attempt without contacting any real mail server (used by CI/Playwright to assert delivery
   bookkeeping without a live SMTP dependency).
2. **SMTP** (`CONTACT_NOTIFICATION_DRIVER=smtp`) — configured only via `SMTP_HOST/_PORT/_SECURE/
   _USERNAME/_PASSWORD/_FROM` and `CONTACT_NOTIFICATION_TO`. Production requires this driver with
   full configuration; missing configuration fails closed (the API still accepts and stores the
   message — persistence never depends on delivery config — but the delivery attempt is recorded
   as a permanent failure with a clear `MISSING_CONFIGURATION` reason instead of retrying forever).

Every attempt is persisted as a delivery-attempt record (`success | failure`, timestamp, reason) —
never logged with the message body or personal data, only the message id and outcome. A bounded
retry policy (small fixed number of attempts with backoff) applies to transient SMTP failures only;
permanently invalid configuration (missing env vars, auth rejected) is not retried. The admin
dashboard/inbox surfaces failed deliveries so a human can follow up manually if automated delivery
never succeeds — the message itself is never lost even if every delivery attempt fails, because it
was already durably persisted in step one.

The public API response is always the same generic success shape regardless of delivery outcome —
delivery-provider details are never exposed to the caller.

## Configuration

See the env var block in `docs/sprint-3.md`.
