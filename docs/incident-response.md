# Incident response

"Something's wrong, start here." This is the triage index; each scenario below links to a
`docs/runbooks/*.md` file with the actual diagnosis/recovery steps. See `docs/operations.md` for
what the health endpoints and logs mean day-to-day, and `docs/backup-restore.md` /
`docs/deployment.md` ("Rollback and version compatibility") for the mechanics this document
points at.

There is no team or rotation for this project — one administrator, no pager, no status page. This
document exists so that person (present or future) doesn't have to reconstruct the diagnosis
process from scratch mid-incident.

## First move, always

1. `curl -s https://<api-host>/api/v1/health/ready | jq` — tells you _which_ dependency is
   failing (`database`/`storage`/`notification-config`), not just "something is wrong." Never
   leaks a hostname, connection string, or credential — safe to paste anywhere.
2. Get a request id if a user or a smoke-test failure reported one (`docs/operations.md` — "Logs")
   and grep production logs for it: `grep '"requestId":"<id>"'`.
3. Decide which runbook below applies. If more than one seems to apply (e.g. readiness reports
   both `database` and `storage` failing), start with the one closer to the request path — a
   database outage often cascades into apparent storage/notification failures because the whole
   process is unhealthy, not because storage itself is down.

## Triage table

| Symptom                                                                                                            | Runbook                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `/health/ready` reports `database: false`, or requests fail with 5xx and Prisma errors in logs                     | `docs/runbooks/database-unavailable.md`    |
| `/health/ready` reports `storage: false`, media upload/approve/download fails                                      | `docs/runbooks/storage-unavailable.md`     |
| Contact form submits succeed (`201`) but the admin never receives the email                                        | `docs/runbooks/smtp-unavailable.md`        |
| Unexpected logouts, "invalid refresh token" for a session that should be valid, or suspected credential compromise | `docs/runbooks/authentication-incident.md` |
| `pnpm media:reconcile` reports `error`-severity findings, or a public image/CV/portrait 404s unexpectedly          | `docs/runbooks/media-inconsistency.md`     |
| `prisma migrate deploy` fails partway, or `prisma migrate status` reports drift                                    | `docs/runbooks/failed-migration.md`        |
| A deploy needs to be reversed (bad app version, not a data-loss migration)                                         | `docs/runbooks/rollback.md`                |
| A flood of contact submissions, or the `contact` rate limit is being hit legitimately by an abuser                 | `docs/runbooks/contact-spam.md`            |

## Data-loss risk, ranked

From lowest to highest risk, so you know how much caution a given recovery step actually needs:

1. **Read-only diagnosis** (`health/ready`, `prisma migrate status`, log greps, `pnpm media:reconcile` without `--repair`) — zero risk, always safe, always the first step.
2. **`pnpm media:reconcile --repair --yes`** — moves misplaced objects only; refuses to overwrite, refuses to invent bytes. Low risk, but not zero (see `docs/runbooks/media-inconsistency.md`).
3. **Application redeploy / rollback to a previous image** — low risk if the database schema is compatible with both versions (see `docs/deployment.md` "Rollback and version compatibility").
4. **`pnpm db:restore` (default target)** — restores into a separate, disposable database; cannot touch production data. Safe to run freely for verification/rehearsal.
5. **`pnpm db:restore -- --replace-source`** — the one genuinely destructive operation in this repo's own tooling. Overwrites the database `DATABASE_URL` points at. Always back up the _current_ (possibly broken) state first, even in an incident — see `docs/runbooks/failed-migration.md`.

## Post-incident

Every runbook ends with a short "post-incident checks" section. The durable follow-up (not scripted
here, since it depends on what actually happened) is: note what happened and why, and if it
revealed a real gap (a missing check, a runbook that didn't cover the actual failure mode, a
monitoring blind spot), treat closing that gap as real follow-up work — not everything that goes
wrong needs a new automated check, but silently repeating the same manual recovery every time is a
sign one might be worth adding.
