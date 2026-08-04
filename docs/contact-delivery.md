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

**An "attempt" means one real call to `ContactNotificationAdapter.send` — never a summary of the
outcome.** Every real send, automatic or manual, is persisted as its own `ContactDeliveryAttempt`
row (`contactMessageId`, `attemptNumber`, `success`, `reason?`, `createdAt`) — never logged with
the message body or personal data, only the message id and outcome. `attemptNumber` is
monotonically increasing per message, allocated from the persisted maximum
(`aggregate({_max: {attemptNumber}})`) inside the same transaction as the write, and enforced
unique by a `@@unique([contactMessageId, attemptNumber])` database constraint — two concurrent
sends can never be recorded under the same number, and no send can go unrecorded (see
`ContactService.recordAttempt`, `apps/api/src/contact/contact.service.ts`).

The initial `POST /api/v1/contact` submission itself may make up to two real sends (one immediate
attempt, one automatic retry on failure, both bounded by `MAX_DELIVERY_ATTEMPTS`) — each is its own
attempt row, numbered 1 and 2. A bounded retry policy (small fixed number of attempts with backoff)
applies to transient SMTP failures only; permanently invalid configuration (missing env vars, auth
rejected) is not retried. The admin dashboard/inbox surfaces failed deliveries so a human can
follow up manually if automated delivery never succeeds — the message itself is never lost even if
every delivery attempt fails, because it was already durably persisted in step one.

The public API response is always the same generic success shape regardless of delivery outcome —
delivery-provider details are never exposed to the caller.

## Manual retry (Sprint 4)

`POST /api/v1/admin/messages/:id/retry-notification` (authenticated, CSRF-protected like every
other admin mutation) re-attempts delivery for a message whose most recent delivery attempt
failed. Implementation: `ContactService.retryNotification` (`apps/api/src/contact/contact.service.ts`).

- **Idempotent claim, not a queue**: `ContactMessage.retryClaimedAt` is set via a single atomic
  conditional `UPDATE ... WHERE id = ? AND (retryClaimedAt IS NULL OR retryClaimedAt < cutoff)`.
  The `updateMany` result count tells the caller whether it won the claim — there is no
  read-then-write gap a second concurrent request could land in. A claim older than 2 minutes
  (`RETRY_CLAIM_TTL_MS`) is treated as abandoned (the process crashed mid-attempt) and becomes
  reclaimable. A reliable database-backed claim is sufficient for this single-administrator
  portfolio — a distributed queue would be solving a problem that doesn't exist here.
- **Bounded, not infinite**: a message that has accumulated `MAX_DELIVERY_ATTEMPTS` (5, counting
  the original submit-time attempts) real-send attempt rows refuses further retries with
  `409 RETRY_LIMIT_REACHED` — a persistently broken SMTP configuration must surface as "stop and
  investigate", not silently consume admin clicks forever. Because the limit is checked against
  real attempt rows (one per real send, never per API call), it cannot be inflated or evaded by
  retrying quickly or concurrently.
- **Claim held**: a retry already in flight (or a full send/release round trip so fast the second
  request's claim attempt lands before the first releases it) gets `409 RETRY_IN_PROGRESS` — the
  atomic claim (`updateMany` above) guarantees at most one real SMTP send and one allocated
  `attemptNumber` per retry, even under concurrent requests; the losing request never calls the
  notification adapter and never consumes an attempt slot.
- Every real send — success or failure — allocates its own `ContactDeliveryAttempt` row
  (see above) and, for manual retries, an `AuditLog` entry
  (`CONTACT_MESSAGE_NOTIFICATION_RETRIED`) recording the real `attemptNumber` and outcome; the
  attempt-row write, claim release, and audit entry share one database transaction, so a failure
  partway through (e.g. the message being deleted mid-send) never leaves a phantom attempt row or
  a falsely-cleared claim — the claim is released unconditionally only after a successful attempt
  write, so a failed retry remains retryable rather than getting silently stuck.
- The message body is never logged — only the outcome, same as the original submit-time delivery.
- `ContactMessage`/list and detail API responses expose `retryExhausted: boolean` — explicit,
  server-derived from the real attempt count (`>= MAX_DELIVERY_ATTEMPTS`), not left for the CMS to
  infer from a possibly-truncated `deliveryAttempts` array. The CMS message list/detail view
  (`ContactRowActions.tsx`) shows a **RETRY NOTIFICATION** button whenever the latest delivery
  attempt failed **and** `retryExhausted` is `false`, behind the same keyboard-accessible
  confirm-dialog pattern used for delete. The dashboard's existing `failedNotifications` count
  (`apps/api/src/dashboard/dashboard.service.ts`) reflects retries automatically — no separate
  counter to keep in sync.

## Real SMTP protocol testing (Sprint 4)

`apps/api/src/contact/notification/smtp-notification.adapter.integration.test.ts` exercises
`SmtpNotificationAdapter` over the real SMTP protocol against Mailpit — never a mocked
`nodemailer` transport. Gated on `MAILPIT_API_URL` the same way
`s3-storage.adapter.integration.test.ts` gates on `MEDIA_STORAGE_ENDPOINT`: self-skips when no
Mailpit instance is configured locally, required in CI. Covers: a successful send captured with
the correct recipient/`Reply-To`/subject, the plain-text body (including that HTML in visitor
input is delivered as literal text, never rendered), Unicode content round-tripping correctly, and
`delivered: false` with a non-throwing, credential-free `reason` against an unreachable host and
against a reachable-but-non-SMTP port. This proves the SMTP _protocol_ works against Mailpit — it
is not, and must never be described as, verification against a real production mail provider.

## Configuration

See the env var block in `docs/sprint-3.md`.
