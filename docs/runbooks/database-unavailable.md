# Runbook: database unavailable

## Symptoms

- `GET /api/v1/health/ready` returns `503` with `database: false` in `checks`.
- Requests that touch the database fail with `5xx`; `grep '"statusCode":5' `/`grep '"level":"error"'`
  in the API logs shows Prisma connection errors (`P1001`, `P1002`, connection refused/timeout).
- `GET /api/v1/health/live` still returns `200` — this is correct, not a contradiction: liveness
  never depends on PostgreSQL (`docs/operations.md`).

## Immediate containment

- Nothing to actively contain — a database-unavailable API instance already fails closed
  (readiness `503` stops new traffic being routed to it by anything honoring the readiness probe;
  every write path that needs the database fails loudly with a `5xx`, never a silent partial
  write).
- Do not restart the API process repeatedly hoping it reconnects — `PrismaService` reconnects on
  its own once the database is reachable again; restarting doesn't speed that up and discards
  in-flight request state for no benefit.

## Diagnosis

```bash
pnpm exec prisma migrate status                    # can Prisma reach it at all, and is the schema current?
curl -s https://<api-host>/api/v1/health/ready | jq # confirm which check(s) are actually failing
```

If `prisma migrate status` itself hangs or times out: the database host/port is unreachable
(network/firewall/DNS), not a schema or credentials problem — check the database provider's own
status, not application code.

If it connects but reports errors: check credentials (`DATABASE_URL`'s user/password) and that the
named database still exists — a credential rotation or accidental database drop looks identical to
"unavailable" from the API's perspective.

## Safe recovery

- **Transient outage (network blip, provider maintenance)**: no application action needed once the
  database is reachable again — `PrismaService` reconnects automatically; confirm with
  `curl .../health/ready`.
- **Credentials changed**: update `DATABASE_URL` in the deployment's environment configuration and
  restart the API (a restart _is_ correct here, since the process needs the new env var — this is
  different from the "don't restart hoping it reconnects" case above).
- **Database itself is corrupted/lost and unrecoverable in place**: this is a restore, not a
  reconnect — stop here and go to `docs/backup-restore.md` ("Production restore procedure") and
  `docs/runbooks/failed-migration.md` if the loss happened mid-migration.

## Validation

- `curl -s https://<api-host>/api/v1/health/ready` returns `200`, `database: true`.
- `pnpm smoke:deployment -- --base-url=https://<web-host> --api-base-url=https://<api-host>`
  passes.

## Rollback / escalation point

If the database is reachable but the _application_ is still failing (readiness passes but requests
still 5xx), this is no longer a database-unavailable incident — check the actual error in the logs;
it's a different failure mode.

## Data-loss risk

None from this runbook's own actions — every step here is read-only diagnosis or waiting for
provider-side recovery. Data-loss risk only enters if this escalates to a restore
(`docs/backup-restore.md`), which is a separate, explicitly confirmed action.

## Must not do

- Do not run `prisma migrate reset` to "fix" a connectivity problem — it doesn't address
  unreachability and, if it _does_ reach the database, it destroys all data.
- Do not point `DATABASE_URL` at a different (e.g. staging) database "temporarily" — this
  silently serves the wrong data to real users and is worse than downtime.

## Post-incident checks

- Confirm `AuditLog`/`ContactDeliveryAttempt` rows created just before the outage look complete
  (no truncated writes) once the database is back.
- If the outage was provider-side, note the duration and cause for future reference; if it was a
  credential/config issue, confirm the fix is reflected in the deployment's actual environment
  configuration, not just applied ad hoc to one running instance.
