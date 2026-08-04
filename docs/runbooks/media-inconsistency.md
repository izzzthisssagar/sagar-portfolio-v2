# Runbook: media inconsistency

Covers: `pnpm media:reconcile` reporting findings, or a public media route (image, CV, portrait)
behaving unexpectedly (404 when it shouldn't, or serving from the wrong pipeline stage).

## Symptoms

- `pnpm media:reconcile` reports one or more `error`-severity findings.
- A published project/Field Note's image 404s, the active CV download 404s despite the CMS showing
  a CV as active, or the portrait shows the `PORTRAIT ASSET PENDING` placeholder despite one being
  configured.

## Immediate containment

None required — a media inconsistency doesn't take the site down; at worst, specific
images/documents are unavailable. Confirm scope first (see Diagnosis) before doing anything.

## Diagnosis

```bash
pnpm media:reconcile              # dry-run, human-readable
pnpm media:reconcile -- --json    # machine-readable, for scripting/diffing
pnpm media:reconcile -- --verify-checksums   # slower — downloads every referenced object;
                                              # run this only when integrity (not just presence)
                                              # is in question, e.g. after a storage incident
```

Read every `error`-severity finding's code (`docs/media-pipeline.md` has the full table) before
acting — the right fix depends entirely on which code fired:

- **`MISSING_OBJECT`**: a DB row references an object that isn't in storage. Not auto-repairable —
  requires a human decision: re-upload the asset (if the source file still exists elsewhere), or
  clear the reference (unset the portrait/CV activation, remove the project-evidence/Field-Note
  image link) if the asset is genuinely gone.
- **`STATUS_PREFIX_MISMATCH`**: the object exists but under the wrong storage prefix for its DB
  status. **This one auto-repairs** — see below.
- **`ORPHANED_OBJECT`**: an object exists with no DB row pointing at it — informational
  (`warning`, not `error`); usually a leftover from an interrupted operation. Not auto-repaired
  (never assumed to belong to any particular row); safe to leave, or manually delete once you've
  confirmed via `ORPHANED_OBJECT`'s storage key that nothing legitimate references it under a
  different key.
- **`DUPLICATE_STORAGE_KEY`**: two `MediaAsset` rows share a key — should be impossible given the
  DB unique constraint; if this ever fires, treat it as a serious integrity bug worth investigating
  directly in the database, not just repairing around.
- **`CHECKSUM_MISMATCH`** (only surfaces with `--verify-checksums`): the object's bytes don't match
  the recorded SHA-256 — possible storage corruption or an out-of-band object replacement. Not
  auto-repaired; treat the object as untrusted (don't serve it) until manually verified.
- **`ACTIVE_CV_OBJECT_MISSING`** / **`PORTRAIT_OBJECT_MISSING`** / **`FEATURED_IMAGE_OBJECT_MISSING`**
  / **`SOCIAL_IMAGE_OBJECT_MISSING`** / **`PROJECT_MEDIA_OBJECT_MISSING`**: a specific reference
  point (CV activation, portrait, a post/project's image field) points at a missing object — fix by
  re-uploading and re-activating/re-linking through the normal CMS flow
  (`docs/asset-activation.md` §4 for portrait/CV specifically), not by editing the database
  directly.

## Safe recovery

**Auto-repairable case** (`STATUS_PREFIX_MISMATCH` only):

```bash
pnpm media:reconcile -- --repair --yes
```

- Moves each misplaced object to the storage prefix its DB status says it belongs at — the same
  direction `media.service.ts` itself moves objects on approve/archive.
- Refuses (skips, doesn't fail the whole run) any action whose source object no longer exists or
  whose destination is already occupied — read the printed outcomes; a skip means "needs a human,"
  not "silently ignored."
- Writes one `AuditLog` row (`action: 'media.reconcile.repair'`) recording exactly what was
  attempted and the outcome of each action.

**Everything else** requires the specific fix named above per finding code — there is no
one-size-fixes-all repair, deliberately (`media-reconcile-lib.ts`'s own doc comment: repair "never
marks an object approved merely because it exists").

## Validation

- `pnpm media:reconcile` reports zero `error`-severity findings.
- The specific public route that was failing now serves correctly (check directly, not just via
  the reconcile report).

## Rollback / escalation point

`--repair --yes` only ever moves an object within the same storage backend and updates the owning
row's `storageKey` — if a repair was wrong (shouldn't be possible given the refusal conditions
above, but if the underlying DB `status` itself was wrong), the fix is to correct the DB `status`
via the normal admin flow and re-run reconcile, not to hand-reverse the storage move.

## Data-loss risk

- Dry-run reconcile: none — fully read-only.
- `--repair --yes`: low — it only moves objects (never deletes), and refuses to overwrite an
  occupied destination. The only loss vector is if a source object legitimately needed to stay
  where it was for some reason not captured by DB status — not expected given how `status` and
  storage prefix are supposed to correspond.
- Manually deleting an `ORPHANED_OBJECT`: irreversible for that object. Only do this after
  confirming (via its storage key/content) that nothing legitimate references it.

## Must not do

- Do not mark a `MISSING_OBJECT` row's status as if the object were still present — that produces a
  public route that appears to work until someone actually requests the file.
- Do not run `--repair --yes` against production without having run the dry-run report first and
  read every finding.

## Post-incident checks

- Re-run `pnpm media:reconcile` one more time after any manual fix — confirm it's actually clean,
  not just "probably fixed."
- If the root cause was a storage outage, see `docs/runbooks/storage-unavailable.md` for the
  broader incident, not just the media-layer symptom.
