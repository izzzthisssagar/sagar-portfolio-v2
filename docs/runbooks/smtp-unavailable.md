# Runbook: SMTP unavailable

## Symptoms

- Contact form submissions still succeed (`201`) — persistence never depends on delivery, by
  design (`docs/contact-delivery.md`) — but the admin never receives the email.
- The admin message inbox (`/admin/messages`) shows messages with a failed delivery status.
- `/api/v1/health/ready`'s `notification-config` check is **not** a live SMTP reachability check —
  it only confirms the selected driver's required fields are present (`docs/operations.md`
  explains why: this is a documented, deliberate limitation, not a bug). A live SMTP outage does
  **not** show up as `503` here — that's exactly why this runbook exists as a separate diagnosis
  path rather than "check readiness."

## Immediate containment

- None needed at the infrastructure level — a real SMTP outage doesn't affect the public site or
  contact-form submission at all; messages are safely persisted regardless
  (`ContactService.submit` writes the message first, attempts delivery second,
  `docs/contact-delivery.md`).
- Do not tell users the contact form is "down" — it isn't; only the notification email is
  delayed.

## Diagnosis

```bash
# In the admin inbox, filter for messages whose most recent delivery attempt failed.
# Or, directly against the database:
psql "$DATABASE_URL" -c \
  "SELECT cm.id, cm.email, cm.\"createdAt\", cda.success, cda.reason, cda.\"createdAt\" AS attempted_at
   FROM \"ContactMessage\" cm
   JOIN \"ContactDeliveryAttempt\" cda ON cda.\"contactMessageId\" = cm.id
   WHERE cda.success = false
   ORDER BY cda.\"createdAt\" DESC LIMIT 20;"
```

- `reason` on a failed `ContactDeliveryAttempt` row indicates what failed — connection refused,
  auth rejected, timeout — without ever containing the message body or SMTP credentials
  (`docs/contact-delivery.md`).
- If every recent attempt has the same `reason`, it's almost certainly the relay itself (down,
  credentials rotated, or a provider-side block) rather than per-message.
- Check `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USERNAME`/`SMTP_FROM` against what the SMTP
  provider's dashboard/status page currently expects — a provider-side credential rotation or TLS
  requirement change looks identical to "unavailable" from here.

## Safe recovery

1. Fix the underlying SMTP configuration/provider issue (credentials, host, provider outage
   resolved).
2. Retry the specific failed message(s) rather than waiting for a resubmission:
   `POST /api/v1/admin/messages/:id/retry-notification` (authenticated, CSRF-protected; also
   available as a button in the admin inbox UI — see `docs/contact-delivery.md` "Manual retry").
   This is a bounded, idempotent claim (`retryClaimedAt`) — safe to click once and wait; clicking
   again while a retry is already in flight returns `409 RETRY_IN_PROGRESS`, not a duplicate send.
3. For a bulk backlog (many messages failed during an extended outage), retry them individually
   through the admin UI rather than scripting bulk retries — there is deliberately no bulk-retry
   endpoint (`docs/contact-delivery.md`'s retry design is a single-message idempotent claim, not a
   queue processor); scripting around that by calling the endpoint in a loop defeats the
   in-flight/backoff protections it exists to provide.

## Validation

- A manual retry against a previously-failed message returns success and a new
  `ContactDeliveryAttempt` row with `success: true`.
- Submit a real test message through the public contact form and confirm it arrives.

## Rollback / escalation point

None of this runbook's actions modify application code or schema — there's nothing to roll back.
If retries keep failing with the same `reason` after the provider confirms the relay is healthy,
the problem is in this application's SMTP configuration, not the provider — re-check
`docs/runtime-configuration.md`'s SMTP variable list against what's actually deployed.

## Data-loss risk

None — the message is durably persisted before any delivery attempt, regardless of outcome
(`docs/contact-delivery.md`). The only "loss" possible here is a delayed notification, not a lost
message.

## Must not do

- Do not log or print the message body, `SMTP_PASSWORD`, or full SMTP connection details while
  diagnosing — `ContactDeliveryAttempt.reason` and structured logs are redacted specifically so
  this diagnosis never needs raw credentials or content.
- Do not build an ad hoc bulk-retry script against the retry endpoint — see above.

## Post-incident checks

- Confirm the admin inbox's failed-delivery count returns to its normal baseline (near zero).
- If the outage was provider-side and prolonged, consider whether `CONTACT_NOTIFICATION_TO` or the
  provider itself needs a longer-term change — not something this runbook decides, but worth
  flagging.
