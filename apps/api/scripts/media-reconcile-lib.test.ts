import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyRepairs,
  hasBlockingFindings,
  planRepairs,
  reconcile,
  type Finding,
  type MediaAssetRow,
  type ReconcileDeps,
  type RepairDeps,
} from './media-reconcile-lib';

function row(
  overrides: Partial<MediaAssetRow> & { id: string; storageKey: string },
): MediaAssetRow {
  return {
    status: 'APPROVED',
    sha256: createHash('sha256').update(overrides.id).digest('hex'),
    extension: 'png',
    ...overrides,
  };
}

/** Minimal in-memory fake satisfying ReconcileDeps, configurable per test.
 *
 * CV/portrait default to a "fully configured, object present" state (rather than "unconfigured")
 * so tests exercising unrelated checks aren't polluted by CV_NOT_CONFIGURED/PORTRAIT_NOT_CONFIGURED
 * info findings — only the tests specifically about CV/portrait override these. */
function fakeDeps(
  overrides: Partial<ReconcileDeps> & { rows?: MediaAssetRow[]; objects?: Map<string, Buffer> },
): ReconcileDeps {
  const defaultCvBytes = Buffer.from('cv');
  const defaultPortraitBytes = Buffer.from('portrait');
  const defaultCvMedia = row({
    id: 'default-cv-media',
    storageKey: 'approved/default-cv.pdf',
    sha256: createHash('sha256').update(defaultCvBytes).digest('hex'),
  });
  const defaultPortraitMedia = row({
    id: 'default-portrait-media',
    storageKey: 'approved/default-portrait.png',
    sha256: createHash('sha256').update(defaultPortraitBytes).digest('hex'),
  });
  // Registered as known MediaAsset rows too (not just storage objects), with sha256 matching
  // their stored bytes, so the CV/portrait defaults never masquerade as ORPHANED_OBJECT or
  // CHECKSUM_MISMATCH in tests that don't care about CV/portrait.
  const rows = [...(overrides.rows ?? []), defaultCvMedia, defaultPortraitMedia];
  const objects = overrides.objects ?? new Map<string, Buffer>();
  if (!objects.has(defaultCvMedia.storageKey))
    objects.set(defaultCvMedia.storageKey, defaultCvBytes);
  if (!objects.has(defaultPortraitMedia.storageKey)) {
    objects.set(defaultPortraitMedia.storageKey, defaultPortraitBytes);
  }
  return {
    async listMediaAssets() {
      return rows;
    },
    async listAllObjectKeys() {
      return Array.from(objects.keys());
    },
    async objectExists(key: string) {
      return objects.has(key);
    },
    async downloadObject(key: string) {
      const value = objects.get(key);
      if (!value) throw new Error(`no object at ${key}`);
      return value;
    },
    async getActiveCvDocument() {
      return { id: 'default-cv', media: defaultCvMedia };
    },
    async hasAnyCvDocument() {
      return true;
    },
    async getPortrait() {
      return defaultPortraitMedia;
    },
    async listBlogImageRefs() {
      return [];
    },
    async listProjectMediaRefs() {
      return [];
    },
    ...overrides,
  };
}

describe('reconcile', () => {
  it('reports no findings when everything is consistent', async () => {
    const objects = new Map([['approved/a', Buffer.from('x')]]);
    const rows = [row({ id: 'm1', storageKey: 'approved/a', status: 'APPROVED' })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: false });
    expect(findings).toEqual([]);
  });

  it('reports MISSING_OBJECT when a MediaAsset row has no backing object', async () => {
    const rows = [row({ id: 'm1', storageKey: 'approved/missing', status: 'APPROVED' })];
    const findings = await reconcile(fakeDeps({ rows, objects: new Map() }), {
      verifyChecksums: false,
    });
    expect(findings).toEqual([
      expect.objectContaining({ code: 'MISSING_OBJECT', severity: 'error', mediaId: 'm1' }),
    ]);
  });

  it('reports STATUS_PREFIX_MISMATCH when status and storage prefix disagree', async () => {
    const objects = new Map([['quarantine/a', Buffer.from('x')]]);
    const rows = [row({ id: 'm1', storageKey: 'quarantine/a', status: 'APPROVED' })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: false });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'STATUS_PREFIX_MISMATCH',
        severity: 'error',
        mediaId: 'm1',
        details: expect.objectContaining({
          expectedPrefix: 'approved',
          actualPrefix: 'quarantine',
        }),
      }),
    ]);
  });

  it('treats REJECTED like QUARANTINED for the expected prefix (rejection never moves storage)', async () => {
    const objects = new Map([['quarantine/a', Buffer.from('x')]]);
    const rows = [row({ id: 'm1', storageKey: 'quarantine/a', status: 'REJECTED' })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: false });
    expect(findings).toEqual([]);
  });

  it('does not double-report a missing object as also having a prefix mismatch', async () => {
    const rows = [row({ id: 'm1', storageKey: 'quarantine/a', status: 'APPROVED' })];
    const findings = await reconcile(fakeDeps({ rows, objects: new Map() }), {
      verifyChecksums: false,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('MISSING_OBJECT');
  });

  it('reports ORPHANED_OBJECT for storage objects with no MediaAsset row', async () => {
    const objects = new Map([['approved/orphan', Buffer.from('x')]]);
    const findings = await reconcile(fakeDeps({ rows: [], objects }), { verifyChecksums: false });
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ORPHANED_OBJECT',
        severity: 'warning',
        storageKey: 'approved/orphan',
      }),
    ]);
  });

  it('reports DUPLICATE_STORAGE_KEY when two rows share a storageKey', async () => {
    const objects = new Map([['approved/a', Buffer.from('x')]]);
    const rows = [
      row({ id: 'm1', storageKey: 'approved/a' }),
      row({ id: 'm2', storageKey: 'approved/a' }),
    ];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: false });
    expect(findings.some((f) => f.code === 'DUPLICATE_STORAGE_KEY')).toBe(true);
  });

  it('does not verify checksums unless verifyChecksums is true', async () => {
    const objects = new Map([['approved/a', Buffer.from('actual bytes')]]);
    const rows = [row({ id: 'm1', storageKey: 'approved/a', sha256: 'not-the-real-hash' })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: false });
    expect(findings).toEqual([]);
  });

  it('reports CHECKSUM_MISMATCH when verifyChecksums is true and bytes disagree', async () => {
    const objects = new Map([['approved/a', Buffer.from('actual bytes')]]);
    const rows = [row({ id: 'm1', storageKey: 'approved/a', sha256: 'not-the-real-hash' })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: true });
    expect(findings).toEqual([
      expect.objectContaining({ code: 'CHECKSUM_MISMATCH', severity: 'error', mediaId: 'm1' }),
    ]);
  });

  it('passes checksum verification when bytes hash to the recorded sha256', async () => {
    const bytes = Buffer.from('actual bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const objects = new Map([['approved/a', bytes]]);
    const rows = [row({ id: 'm1', storageKey: 'approved/a', sha256 })];
    const findings = await reconcile(fakeDeps({ rows, objects }), { verifyChecksums: true });
    expect(findings).toEqual([]);
  });

  it('reports CV_NOT_CONFIGURED (info) as "no CV uploaded" when none exist', async () => {
    const findings = await reconcile(
      fakeDeps({ getActiveCvDocument: async () => null, hasAnyCvDocument: async () => false }),
      { verifyChecksums: false },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'CV_NOT_CONFIGURED',
        severity: 'info',
        message: expect.stringContaining('no CV has been uploaded'),
      }),
    ]);
  });

  it('reports CV_NOT_CONFIGURED (info) as "none active" when CvDocuments exist but none is active', async () => {
    const findings = await reconcile(
      fakeDeps({ getActiveCvDocument: async () => null, hasAnyCvDocument: async () => true }),
      { verifyChecksums: false },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'CV_NOT_CONFIGURED',
        severity: 'info',
        message: expect.stringContaining('nothing to serve'),
      }),
    ]);
  });

  it('reports ACTIVE_CV_OBJECT_MISSING when the active CV media has no backing object', async () => {
    const media = row({ id: 'cv-media', storageKey: 'approved/cv.pdf' });
    const findings = await reconcile(
      fakeDeps({ getActiveCvDocument: async () => ({ id: 'cv-1', media }), objects: new Map() }),
      { verifyChecksums: false },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'ACTIVE_CV_OBJECT_MISSING',
        severity: 'error',
        mediaId: 'cv-media',
      }),
    ]);
  });

  it('reports nothing about CV when the active CV media object exists', async () => {
    const media = row({ id: 'cv-media', storageKey: 'approved/cv.pdf' });
    const objects = new Map([['approved/cv.pdf', Buffer.from('%PDF')]]);
    const findings = await reconcile(
      fakeDeps({ getActiveCvDocument: async () => ({ id: 'cv-1', media }), objects }),
      { verifyChecksums: false },
    );
    expect(findings.filter((f) => f.code.includes('CV'))).toEqual([]);
  });

  it('reports PORTRAIT_NOT_CONFIGURED (info) when no portrait is set', async () => {
    const findings = await reconcile(fakeDeps({ getPortrait: async () => null }), {
      verifyChecksums: false,
    });
    expect(findings).toEqual([
      expect.objectContaining({ code: 'PORTRAIT_NOT_CONFIGURED', severity: 'info' }),
    ]);
  });

  it('reports PORTRAIT_OBJECT_MISSING when the configured portrait has no backing object', async () => {
    const media = row({ id: 'portrait-media', storageKey: 'approved/portrait.png' });
    const findings = await reconcile(
      fakeDeps({ getPortrait: async () => media, objects: new Map() }),
      {
        verifyChecksums: false,
      },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'PORTRAIT_OBJECT_MISSING',
        severity: 'error',
        mediaId: 'portrait-media',
      }),
    ]);
  });

  it('reports FEATURED_IMAGE_OBJECT_MISSING and SOCIAL_IMAGE_OBJECT_MISSING independently', async () => {
    const featured = row({ id: 'feat-media', storageKey: 'approved/feat.png' });
    const social = row({ id: 'soc-media', storageKey: 'approved/soc.png' });
    const findings = await reconcile(
      fakeDeps({
        listBlogImageRefs: async () => [
          { blogPostId: 'post-1', slug: 'my-post', field: 'featuredImageId', media: featured },
          { blogPostId: 'post-1', slug: 'my-post', field: 'socialImageId', media: social },
        ],
        objects: new Map(),
      }),
      { verifyChecksums: false },
    );
    expect(findings.map((f) => f.code).sort()).toEqual(
      ['FEATURED_IMAGE_OBJECT_MISSING', 'SOCIAL_IMAGE_OBJECT_MISSING'].sort(),
    );
  });

  it('reports PROJECT_MEDIA_OBJECT_MISSING for missing project evidence images', async () => {
    const media = row({ id: 'proj-media', storageKey: 'approved/evidence.png' });
    const findings = await reconcile(
      fakeDeps({
        listProjectMediaRefs: async () => [{ projectMediaId: 'pm-1', projectId: 'proj-1', media }],
        objects: new Map(),
      }),
      { verifyChecksums: false },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'PROJECT_MEDIA_OBJECT_MISSING',
        severity: 'error',
        mediaId: 'proj-media',
      }),
    ]);
  });
});

describe('hasBlockingFindings', () => {
  it('is true when any finding is severity error', () => {
    const findings: Finding[] = [{ code: 'MISSING_OBJECT', severity: 'error', message: 'x' }];
    expect(hasBlockingFindings(findings)).toBe(true);
  });

  it('is false when findings are only warning/info', () => {
    const findings: Finding[] = [
      { code: 'ORPHANED_OBJECT', severity: 'warning', message: 'x' },
      { code: 'CV_NOT_CONFIGURED', severity: 'info', message: 'x' },
    ];
    expect(hasBlockingFindings(findings)).toBe(false);
  });

  it('is false for an empty finding list', () => {
    expect(hasBlockingFindings([])).toBe(false);
  });
});

describe('planRepairs', () => {
  it('derives a move action from a STATUS_PREFIX_MISMATCH finding', () => {
    const findings: Finding[] = [
      {
        code: 'STATUS_PREFIX_MISMATCH',
        severity: 'error',
        message: 'x',
        mediaId: 'm1',
        storageKey: 'quarantine/abc.png',
        details: { expectedPrefix: 'approved', actualPrefix: 'quarantine', status: 'APPROVED' },
      },
    ];
    expect(planRepairs(findings)).toEqual([
      { mediaId: 'm1', fromKey: 'quarantine/abc.png', toKey: 'approved/abc.png', reason: 'x' },
    ]);
  });

  it('never derives an action from MISSING_OBJECT, ORPHANED_OBJECT, or CHECKSUM_MISMATCH', () => {
    const findings: Finding[] = [
      {
        code: 'MISSING_OBJECT',
        severity: 'error',
        message: 'x',
        mediaId: 'm1',
        storageKey: 'approved/a',
      },
      { code: 'ORPHANED_OBJECT', severity: 'warning', message: 'x', storageKey: 'approved/b' },
      {
        code: 'CHECKSUM_MISMATCH',
        severity: 'error',
        message: 'x',
        mediaId: 'm2',
        storageKey: 'approved/c',
      },
    ];
    expect(planRepairs(findings)).toEqual([]);
  });
});

describe('applyRepairs', () => {
  function fakeRepairDeps(
    objects: Map<string, Buffer>,
  ): RepairDeps & { updates: Array<[string, string]> } {
    const updates: Array<[string, string]> = [];
    return {
      updates,
      async moveObject(fromKey, toKey) {
        const value = objects.get(fromKey);
        if (!value) throw new Error('no such object');
        objects.set(toKey, value);
        objects.delete(fromKey);
      },
      async objectExists(key) {
        return objects.has(key);
      },
      async updateMediaAssetStorageKey(mediaId, newKey) {
        updates.push([mediaId, newKey]);
      },
    };
  }

  it('applies a valid move and records the DB update', async () => {
    const objects = new Map([['quarantine/a', Buffer.from('x')]]);
    const deps = fakeRepairDeps(objects);
    const outcomes = await applyRepairs(deps, [
      { mediaId: 'm1', fromKey: 'quarantine/a', toKey: 'approved/a', reason: 'x' },
    ]);
    expect(outcomes).toEqual([
      {
        action: { mediaId: 'm1', fromKey: 'quarantine/a', toKey: 'approved/a', reason: 'x' },
        applied: true,
      },
    ]);
    expect(objects.has('approved/a')).toBe(true);
    expect(objects.has('quarantine/a')).toBe(false);
    expect(deps.updates).toEqual([['m1', 'approved/a']]);
  });

  it('skips when the source object no longer exists', async () => {
    const deps = fakeRepairDeps(new Map());
    const outcomes = await applyRepairs(deps, [
      { mediaId: 'm1', fromKey: 'quarantine/gone', toKey: 'approved/gone', reason: 'x' },
    ]);
    expect(outcomes[0]).toMatchObject({
      applied: false,
      skippedReason: expect.stringContaining('no longer exists'),
    });
    expect(deps.updates).toEqual([]);
  });

  it('skips when the destination key is already occupied', async () => {
    const objects = new Map([
      ['quarantine/a', Buffer.from('x')],
      ['approved/a', Buffer.from('already here')],
    ]);
    const deps = fakeRepairDeps(objects);
    const outcomes = await applyRepairs(deps, [
      { mediaId: 'm1', fromKey: 'quarantine/a', toKey: 'approved/a', reason: 'x' },
    ]);
    expect(outcomes[0]).toMatchObject({
      applied: false,
      skippedReason: expect.stringContaining('already occupied'),
    });
    expect(objects.get('quarantine/a')?.toString()).toBe('x');
    expect(deps.updates).toEqual([]);
  });

  it('moves the object back if the DB update fails after a successful move', async () => {
    const objects = new Map([['quarantine/a', Buffer.from('x')]]);
    const deps = fakeRepairDeps(objects);
    deps.updateMediaAssetStorageKey = async () => {
      throw new Error('db down');
    };
    const outcomes = await applyRepairs(deps, [
      { mediaId: 'm1', fromKey: 'quarantine/a', toKey: 'approved/a', reason: 'x' },
    ]);
    expect(outcomes[0]).toMatchObject({
      applied: false,
      error: expect.stringContaining('db down'),
    });
    expect(objects.has('quarantine/a')).toBe(true);
    expect(objects.has('approved/a')).toBe(false);
  });

  it("one action's failure does not abort the batch", async () => {
    const objects = new Map([
      ['quarantine/a', Buffer.from('x')],
      ['quarantine/b', Buffer.from('y')],
    ]);
    const deps = fakeRepairDeps(objects);
    const outcomes = await applyRepairs(deps, [
      { mediaId: 'm1', fromKey: 'quarantine/missing', toKey: 'approved/missing', reason: 'x' },
      { mediaId: 'm2', fromKey: 'quarantine/b', toKey: 'approved/b', reason: 'y' },
    ]);
    expect(outcomes[0]?.applied).toBe(false);
    expect(outcomes[1]?.applied).toBe(true);
    expect(objects.has('approved/b')).toBe(true);
  });
});
