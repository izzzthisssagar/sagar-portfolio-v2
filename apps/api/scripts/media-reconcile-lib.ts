import { createHash } from 'node:crypto';

/**
 * Core detection/repair logic for `media-reconcile.ts`, factored out so it can be unit-tested
 * against fakes (a fake Prisma-shaped client + `MemoryStorageAdapter`) without a real database or
 * storage backend. The CLI entrypoint (`media-reconcile.ts`) wires this up against the real
 * `PrismaService` and `buildMediaStorageAdapter()` from `storage.module.ts` — this file never
 * imports either, and never talks to a filesystem, network, or database directly.
 */

export type Severity = 'info' | 'warning' | 'error';

export type FindingCode =
  | 'MISSING_OBJECT'
  | 'STATUS_PREFIX_MISMATCH'
  | 'ORPHANED_OBJECT'
  | 'DUPLICATE_STORAGE_KEY'
  | 'CHECKSUM_MISMATCH'
  | 'CV_NOT_CONFIGURED'
  | 'ACTIVE_CV_OBJECT_MISSING'
  | 'PORTRAIT_NOT_CONFIGURED'
  | 'PORTRAIT_OBJECT_MISSING'
  | 'FEATURED_IMAGE_OBJECT_MISSING'
  | 'SOCIAL_IMAGE_OBJECT_MISSING'
  | 'PROJECT_MEDIA_OBJECT_MISSING';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  mediaId?: string;
  storageKey?: string;
  details?: Record<string, unknown>;
}

/** The subset of `MediaAsset` fields reconciliation logic actually reads — deliberately narrower
 * than the full Prisma model so tests can pass plain objects instead of real Prisma rows. */
export interface MediaAssetRow {
  id: string;
  storageKey: string;
  status: 'QUARANTINED' | 'APPROVED' | 'REJECTED' | 'ARCHIVED';
  sha256: string;
  extension: string;
}

export interface BlogImageRef {
  blogPostId: string;
  slug: string;
  field: 'featuredImageId' | 'socialImageId';
  media: MediaAssetRow;
}

export interface ProjectMediaRef {
  projectMediaId: string;
  projectId: string;
  media: MediaAssetRow;
}

/** Everything reconciliation detection needs from the outside world, all read-only. The CLI
 * fulfils this from Prisma + the configured `MediaStorageAdapter`; tests fulfil it from plain
 * arrays/maps and `MemoryStorageAdapter`. */
export interface ReconcileDeps {
  listMediaAssets(): Promise<MediaAssetRow[]>;
  /** Full enumeration of every object key actually present in the storage backend — a directory
   * walk for local storage, a paginated `ListObjectsV2` for S3. Used only for orphan detection. */
  listAllObjectKeys(): Promise<string[]>;
  /** Lightweight existence check (HEAD-equivalent) — never downloads the object body. */
  objectExists(key: string): Promise<boolean>;
  /** Downloads the full object body — only ever called when `verifyChecksums` is set, since this
   * is the expensive path (full transfer of every asset). */
  downloadObject(key: string): Promise<Buffer>;
  getActiveCvDocument(): Promise<{ id: string; media: MediaAssetRow } | null>;
  hasAnyCvDocument(): Promise<boolean>;
  getPortrait(): Promise<MediaAssetRow | null>;
  listBlogImageRefs(): Promise<BlogImageRef[]>;
  listProjectMediaRefs(): Promise<ProjectMediaRef[]>;
}

export interface ReconcileOptions {
  /** Recomputes SHA-256 over the actual downloaded bytes of every object whose row exists, and
   * compares it against `MediaAsset.sha256`. Opt-in (default false) because it requires
   * downloading every referenced object in full — cheap for a handful of local test fixtures,
   * potentially slow and (for S3) billable egress against a real production-sized bucket. Run it
   * periodically/out-of-band rather than on every reconcile invocation. */
  verifyChecksums: boolean;
}

const STATUS_TO_PREFIX: Record<MediaAssetRow['status'], string> = {
  // A rejected asset is never moved out of quarantine — see media.service.ts `reject()`, which
  // only flips the DB status and never touches storage.
  QUARANTINED: 'quarantine',
  REJECTED: 'quarantine',
  APPROVED: 'approved',
  ARCHIVED: 'archived',
};

function prefixOf(key: string): string {
  const slash = key.indexOf('/');
  return slash === -1 ? key : key.slice(0, slash);
}

/** Runs every detection check and returns the full, unfiltered list of findings. Never mutates
 * anything — reconciliation is read-only by construction; only `planRepairs`/`applyRepairs`
 * (invoked separately, and only under `--repair --yes`) ever write. */
export async function reconcile(
  deps: ReconcileDeps,
  options: ReconcileOptions,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const rows = await deps.listMediaAssets();

  // --- Duplicate storage keys (should be impossible given the DB unique constraint; verified
  // defensively anyway). ---
  const byKey = new Map<string, MediaAssetRow[]>();
  for (const row of rows) {
    const existing = byKey.get(row.storageKey);
    if (existing) existing.push(row);
    else byKey.set(row.storageKey, [row]);
  }
  for (const [key, group] of byKey) {
    if (group.length > 1) {
      findings.push({
        code: 'DUPLICATE_STORAGE_KEY',
        severity: 'error',
        message: `${group.length} MediaAsset rows share storageKey "${key}" — the DB unique constraint should make this impossible.`,
        storageKey: key,
        details: { mediaIds: group.map((r) => r.id) },
      });
    }
  }

  // --- Per-row existence + status/prefix checks. ---
  const existsByKey = new Map<string, boolean>();
  for (const row of rows) {
    const exists = await deps.objectExists(row.storageKey);
    existsByKey.set(row.storageKey, exists);
    if (!exists) {
      findings.push({
        code: 'MISSING_OBJECT',
        severity: 'error',
        message: `MediaAsset ${row.id} (status ${row.status}) references storageKey "${row.storageKey}", which does not exist in the storage backend.`,
        mediaId: row.id,
        storageKey: row.storageKey,
      });
      // A missing object has no meaningful prefix to compare against — skip the mismatch check
      // for this row rather than reporting two findings for one root cause.
      continue;
    }
    const expectedPrefix = STATUS_TO_PREFIX[row.status];
    const actualPrefix = prefixOf(row.storageKey);
    if (actualPrefix !== expectedPrefix) {
      findings.push({
        code: 'STATUS_PREFIX_MISMATCH',
        severity: 'error',
        message: `MediaAsset ${row.id} has status ${row.status} (expects prefix "${expectedPrefix}/") but storageKey "${row.storageKey}" carries prefix "${actualPrefix}/".`,
        mediaId: row.id,
        storageKey: row.storageKey,
        details: { expectedPrefix, actualPrefix, status: row.status },
      });
    }
  }

  // --- Orphaned objects: present in storage, referenced by no MediaAsset row. ---
  const knownKeys = new Set(rows.map((r) => r.storageKey));
  const allKeys = await deps.listAllObjectKeys();
  for (const key of allKeys) {
    if (!knownKeys.has(key)) {
      findings.push({
        code: 'ORPHANED_OBJECT',
        severity: 'warning',
        message: `Object "${key}" exists in the storage backend but no MediaAsset row references it.`,
        storageKey: key,
      });
    }
  }

  // --- Checksum verification (opt-in). ---
  if (options.verifyChecksums) {
    for (const row of rows) {
      if (!existsByKey.get(row.storageKey)) continue; // already reported as MISSING_OBJECT
      const buffer = await deps.downloadObject(row.storageKey);
      const actualSha256 = createHash('sha256').update(buffer).digest('hex');
      if (actualSha256 !== row.sha256) {
        findings.push({
          code: 'CHECKSUM_MISMATCH',
          severity: 'error',
          message: `MediaAsset ${row.id} recorded sha256 "${row.sha256}" but the object at "${row.storageKey}" hashes to "${actualSha256}".`,
          mediaId: row.id,
          storageKey: row.storageKey,
          details: { expected: row.sha256, actual: actualSha256 },
        });
      }
    }
  }

  // --- Active CV. ---
  const activeCv = await deps.getActiveCvDocument();
  if (!activeCv) {
    const anyCv = await deps.hasAnyCvDocument();
    findings.push({
      code: 'CV_NOT_CONFIGURED',
      severity: 'info',
      message: anyCv
        ? 'No CvDocument has active=true — the public CV download route has nothing to serve. This is a valid, if incomplete, state.'
        : 'No CvDocument rows exist at all — no CV has been uploaded yet. This is a valid, expected state (see docs/sprint-3.md).',
    });
  } else if (!(await deps.objectExists(activeCv.media.storageKey))) {
    findings.push({
      code: 'ACTIVE_CV_OBJECT_MISSING',
      severity: 'error',
      message: `CvDocument ${activeCv.id} is active but its MediaAsset (${activeCv.media.id}, storageKey "${activeCv.media.storageKey}") has no corresponding storage object — the public CV download route will fail.`,
      mediaId: activeCv.media.id,
      storageKey: activeCv.media.storageKey,
    });
  }

  // --- Portrait. ---
  const portrait = await deps.getPortrait();
  if (!portrait) {
    findings.push({
      code: 'PORTRAIT_NOT_CONFIGURED',
      severity: 'info',
      message:
        'Profile.portraitMediaId is unset — no portrait is configured. This is a valid, expected state (see docs/sprint-3.md).',
    });
  } else if (!(await deps.objectExists(portrait.storageKey))) {
    findings.push({
      code: 'PORTRAIT_OBJECT_MISSING',
      severity: 'error',
      message: `Profile.portraitMediaId references MediaAsset ${portrait.id} (storageKey "${portrait.storageKey}"), which has no corresponding storage object.`,
      mediaId: portrait.id,
      storageKey: portrait.storageKey,
    });
  }

  // --- Field Note (BlogPost) featured/social images. ---
  for (const ref of await deps.listBlogImageRefs()) {
    if (!(await deps.objectExists(ref.media.storageKey))) {
      findings.push({
        code:
          ref.field === 'featuredImageId'
            ? 'FEATURED_IMAGE_OBJECT_MISSING'
            : 'SOCIAL_IMAGE_OBJECT_MISSING',
        severity: 'error',
        message: `BlogPost ${ref.blogPostId} ("${ref.slug}") references ${ref.field} -> MediaAsset ${ref.media.id} (storageKey "${ref.media.storageKey}"), which has no corresponding storage object.`,
        mediaId: ref.media.id,
        storageKey: ref.media.storageKey,
        details: { blogPostId: ref.blogPostId, slug: ref.slug },
      });
    }
  }

  // --- Project evidence images. ---
  for (const ref of await deps.listProjectMediaRefs()) {
    if (!(await deps.objectExists(ref.media.storageKey))) {
      findings.push({
        code: 'PROJECT_MEDIA_OBJECT_MISSING',
        severity: 'error',
        message: `ProjectMedia ${ref.projectMediaId} (project ${ref.projectId}) references MediaAsset ${ref.media.id} (storageKey "${ref.media.storageKey}"), which has no corresponding storage object.`,
        mediaId: ref.media.id,
        storageKey: ref.media.storageKey,
        details: { projectId: ref.projectId, projectMediaId: ref.projectMediaId },
      });
    }
  }

  return findings;
}

export function hasBlockingFindings(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}

// ---------------------------------------------------------------------------------------------
// Repair mode
// ---------------------------------------------------------------------------------------------

export interface RepairAction {
  mediaId: string;
  fromKey: string;
  toKey: string;
  reason: string;
}

/** Derives the repair plan from findings — deliberately narrow: the only automated fix this tool
 * ever performs is moving a misplaced object to the location its DB status says it belongs,
 * exactly mirroring the direction `media.service.ts` itself moves objects on approve/archive.
 * It never infers a status from where an object happens to sit (see
 * `storage-adapter.interface.ts`'s doc comment: don't let repair "mark an object approved merely
 * because it exists" there) and never touches ORPHANED_OBJECT, MISSING_OBJECT, or
 * CHECKSUM_MISMATCH findings — those require a human decision (re-upload, clear a reference, or
 * manually inspect/delete), not an automated move. */
export function planRepairs(findings: Finding[]): RepairAction[] {
  const actions: RepairAction[] = [];
  for (const finding of findings) {
    if (finding.code !== 'STATUS_PREFIX_MISMATCH') continue;
    if (!finding.mediaId || !finding.storageKey || !finding.details) continue;
    const expectedPrefix = finding.details['expectedPrefix'];
    if (typeof expectedPrefix !== 'string') continue;
    const rest = finding.storageKey.slice(finding.storageKey.indexOf('/') + 1);
    const toKey = `${expectedPrefix}/${rest}`;
    actions.push({
      mediaId: finding.mediaId,
      fromKey: finding.storageKey,
      toKey,
      reason: finding.message,
    });
  }
  return actions;
}

export interface RepairDeps {
  moveObject(fromKey: string, toKey: string): Promise<void>;
  objectExists(key: string): Promise<boolean>;
  updateMediaAssetStorageKey(mediaId: string, newKey: string): Promise<void>;
}

export interface RepairOutcome {
  action: RepairAction;
  applied: boolean;
  skippedReason?: string;
  error?: string;
}

/** Applies a repair plan. Conservative by construction:
 *  - Refuses (skips, with a reason) any action whose source object no longer exists — there is
 *    nothing to move, and repair must never invent bytes.
 *  - Refuses any action whose destination key is already occupied by a different object — that
 *    would silently clobber unrelated data.
 *  - Moves the object first, then updates the DB row; if the DB update fails, best-effort moves
 *    the object back so storage and DB stay in agreement (mirrors the compensation pattern
 *    already used by `approve()`/`archive()`/`remove()` in media.service.ts).
 *  - One action's failure never aborts the batch — each row is independent. */
export async function applyRepairs(
  deps: RepairDeps,
  actions: RepairAction[],
): Promise<RepairOutcome[]> {
  const outcomes: RepairOutcome[] = [];
  for (const action of actions) {
    const sourceExists = await deps.objectExists(action.fromKey);
    if (!sourceExists) {
      outcomes.push({
        action,
        applied: false,
        skippedReason:
          'Source object no longer exists — nothing to move; requires human resolution.',
      });
      continue;
    }
    const destinationExists = await deps.objectExists(action.toKey);
    if (destinationExists) {
      outcomes.push({
        action,
        applied: false,
        skippedReason: `Destination key "${action.toKey}" is already occupied — refusing to overwrite.`,
      });
      continue;
    }
    try {
      await deps.moveObject(action.fromKey, action.toKey);
    } catch (error) {
      outcomes.push({
        action,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    try {
      await deps.updateMediaAssetStorageKey(action.mediaId, action.toKey);
      outcomes.push({ action, applied: true });
    } catch (error) {
      await deps.moveObject(action.toKey, action.fromKey).catch(() => {});
      outcomes.push({
        action,
        applied: false,
        error: `DB update failed after moving the object; moved it back. ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return outcomes;
}
