# Runbook: contact spam

## Symptoms

- A burst of contact-form submissions in a short window, obviously non-genuine content, or the
  same sender/IP submitting repeatedly.
- The `contact` route's rate limit (`20 requests / 60s / IP` — `@Throttle` on
  `ContactController`, `docs/security-production.md`) is being hit, either by a legitimate burst
  or by an abuser probing the limit.

## Immediate containment

- **The rate limit is already doing its job automatically** — no action needed to "stop" a flood in
  progress; `20/60s/IP` already caps how fast one source can submit. Confirm this is actually
  holding (see Diagnosis) before assuming it isn't.
- Every submission is still durably persisted regardless of whether it's spam
  (`docs/contact-delivery.md`) — this is intentional (never silently drop user input), which means
  spam containment here is about _triage_, not prevention of storage.

## Diagnosis

```sql
-- Recent submissions, most recent first:
SELECT id, name, email, subject, status, "createdAt", "ipHash"
FROM "ContactMessage"
ORDER BY "createdAt" DESC LIMIT 50;

-- Is one ipHash submitting far more than everything else?
SELECT "ipHash", count(*) FROM "ContactMessage"
WHERE "createdAt" > now() - interval '1 hour'
GROUP BY "ipHash" ORDER BY count(*) DESC LIMIT 10;
```

`ipHash` lets you confirm concentration from one source without ever storing or exposing the raw
IP (`docs/security-production.md`). If the count-per-hash for the top source is at or near
`20 * (window count)`, the rate limit is actively capping them, not failing to.

## Safe recovery

1. **Mark identified spam messages as spam** through the admin UI (`/admin/messages`,
   `ContactRowActions`'s **SPAM** action, or `PATCH` the message status to `spam` — see
   `apps/api/src/contact/contact.dto.ts`'s `CONTACT_STATUSES`). This is a normal CMS action, not an
   emergency one — it just declutters the inbox and the "new" filter.
2. **If the rate limit itself is being probed/exceeded persistently from a small set of sources**
   and the default `20/60s/IP` isn't suffient containment: this is a genuine case for lowering the
   route-specific limit — but that's a configuration change to `ContactController`'s `@Throttle`
   value (a code change, reviewed and deployed normally), not something toggled live. Do not do
   this reactively without confirming it won't also block legitimate bursts (e.g. a post going
   viral and genuinely driving contact submissions).
3. **If spam is getting through at a volume that's a genuine nuisance despite the rate limit**
   (e.g. distributed across many IPs, so per-IP limiting doesn't help): this is a product decision
   (CAPTCHA, honeypot field, stricter validation) outside what an incident runbook should decide
   unilaterally — note it as follow-up work, don't improvise a fix under incident pressure.

## Validation

- The admin inbox's "new" filter no longer shows the marked spam.
- If a rate-limit change was made: `apps/api/src/auth/*.test.ts`-style route-specific rate-limit
  tests still pass, and the change is deployed through the normal path (not a hotfix directly to a
  running container).

## Rollback / escalation point

Marking messages as spam is trivially reversible (change status back). A rate-limit config change,
if made, should be reverted the same way it was deployed (a normal code change) if it turns out to
block legitimate traffic.

## Data-loss risk

None — marking spam changes `status` only; the message content is retained (consistent with never
silently dropping user input). No message is ever deleted by this runbook.

## Must not do

- Do not delete `ContactMessage` rows to "clean up" spam — mark as spam instead; deletion removes
  the audit trail of what was submitted and when, which matters if the volume/pattern needs
  investigating later.
- Do not lower the _global_ rate limit (`docs/security-production.md`'s `60/60s/IP` production
  default) in response to contact-specific spam — the contact route already has its own, separate,
  stricter limit; changing the global default affects every other route for no benefit here.
- Do not raise `RATE_LIMIT_MAX` in production "temporarily" to work around noisy logs — that
  variable is a global fallback, and the CI-only override pattern
  (`docs/security-production.md`) exists specifically so this kind of change never happens
  silently in production.

## Post-incident checks

- Confirm the per-IP submission rate has returned to baseline.
- If a genuine pattern emerged (a specific spam signature, a source that keeps coming back), note
  it — it's the kind of thing that turns into a real product decision (see step 3 above) rather
  than a recurring manual cleanup task.
