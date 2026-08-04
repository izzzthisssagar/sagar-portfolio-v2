import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildMediaStorageAdapter } from '../src/media/storage/storage.module';
import {
  applyRepairs,
  hasBlockingFindings,
  planRepairs,
  reconcile,
  type BlogImageRef,
  type Finding,
  type MediaAssetRow,
  type ReconcileDeps,
  type RepairDeps,
  type RepairOutcome,
} from './media-reconcile-lib';

/**
 * `pnpm media:reconcile [-- --repair --yes] [--json] [--verify-checksums]`
 *
 * Default mode is a read-only, dry-run report of every discrepancy between the `MediaAsset`
 * table and the configured storage backend (see `media-reconcile-lib.ts` for the full check
 * list). `--repair --yes` additionally applies the narrow, conservative set of automated fixes
 * `planRepairs`/`applyRepairs` support (moving a misplaced object back to the storage prefix its
 * DB status says it belongs at) and records an `AuditLog` row. Nothing here ever marks an object
 * approved merely because it exists, and nothing here invents missing bytes — see
 * docs/media-pipeline.md and the doc comments in media-reconcile-lib.ts.
 */

interface Args {
  repair: boolean;
  yes: boolean;
  json: boolean;
  verifyChecksums: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    repair: argv.includes('--repair'),
    yes: argv.includes('--yes'),
    json: argv.includes('--json'),
    verifyChecksums: argv.includes('--verify-checksums'),
  };
}

function toMediaAssetRow(row: {
  id: string;
  storageKey: string;
  status: string;
  sha256: string;
  extension: string;
}): MediaAssetRow {
  return {
    id: row.id,
    storageKey: row.storageKey,
    status: row.status as MediaAssetRow['status'],
    sha256: row.sha256,
    extension: row.extension,
  };
}

function buildDeps(
  prisma: PrismaService,
  storage: ReturnType<typeof buildMediaStorageAdapter>,
): ReconcileDeps {
  return {
    async listMediaAssets() {
      const rows = await prisma.mediaAsset.findMany({
        select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
      });
      return rows.map(toMediaAssetRow);
    },
    async listAllObjectKeys() {
      return storage.list();
    },
    async objectExists(key: string) {
      return storage.exists(key);
    },
    async downloadObject(key: string) {
      return storage.get(key);
    },
    async getActiveCvDocument() {
      const doc = await prisma.cvDocument.findFirst({
        where: { active: true },
        include: {
          media: {
            select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
          },
        },
      });
      if (!doc) return null;
      return { id: doc.id, media: toMediaAssetRow(doc.media) };
    },
    async hasAnyCvDocument() {
      return (await prisma.cvDocument.count()) > 0;
    },
    async getPortrait() {
      const profile = await prisma.profile.findFirst({
        select: {
          portraitMedia: {
            select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
          },
        },
      });
      return profile?.portraitMedia ? toMediaAssetRow(profile.portraitMedia) : null;
    },
    async listBlogImageRefs() {
      const posts = await prisma.blogPost.findMany({
        where: { OR: [{ featuredImageId: { not: null } }, { socialImageId: { not: null } }] },
        select: {
          id: true,
          slug: true,
          featuredImage: {
            select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
          },
          socialImage: {
            select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
          },
        },
      });
      const refs: BlogImageRef[] = [];
      for (const post of posts) {
        if (post.featuredImage) {
          refs.push({
            blogPostId: post.id,
            slug: post.slug,
            field: 'featuredImageId',
            media: toMediaAssetRow(post.featuredImage),
          });
        }
        if (post.socialImage) {
          refs.push({
            blogPostId: post.id,
            slug: post.slug,
            field: 'socialImageId',
            media: toMediaAssetRow(post.socialImage),
          });
        }
      }
      return refs;
    },
    async listProjectMediaRefs() {
      const rows = await prisma.projectMedia.findMany({
        select: {
          id: true,
          projectId: true,
          media: {
            select: { id: true, storageKey: true, status: true, sha256: true, extension: true },
          },
        },
      });
      return rows.map((row) => ({
        projectMediaId: row.id,
        projectId: row.projectId,
        media: toMediaAssetRow(row.media),
      }));
    },
  };
}

function buildRepairDeps(
  prisma: PrismaService,
  storage: ReturnType<typeof buildMediaStorageAdapter>,
): RepairDeps {
  return {
    async moveObject(fromKey: string, toKey: string) {
      await storage.move(fromKey, toKey);
    },
    async objectExists(key: string) {
      return storage.exists(key);
    },
    async updateMediaAssetStorageKey(mediaId: string, newKey: string) {
      await prisma.mediaAsset.update({ where: { id: mediaId }, data: { storageKey: newKey } });
    },
  };
}

function printHuman(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('No discrepancies found.');
    return;
  }
  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;
  console.log(
    `${findings.length} finding(s): ${bySeverity.error} error, ${bySeverity.warning} warning, ${bySeverity.info} info.\n`,
  );
  for (const finding of findings) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaService();
  const storage = buildMediaStorageAdapter();

  try {
    await prisma.$connect();
    const deps = buildDeps(prisma, storage);
    const findings = await reconcile(deps, { verifyChecksums: args.verifyChecksums });

    let repairOutcomes: RepairOutcome[] | undefined;
    if (args.repair) {
      if (!args.yes) {
        console.error(
          '--repair requires --yes to confirm — refusing to modify storage without explicit confirmation.',
        );
        process.exitCode = 2;
        return;
      }
      const actions = planRepairs(findings);
      if (actions.length === 0) {
        console.log('No repairable findings (only STATUS_PREFIX_MISMATCH is auto-repaired).');
      } else {
        const repairDeps = buildRepairDeps(prisma, storage);
        repairOutcomes = await applyRepairs(repairDeps, actions);
        await prisma.auditLog.create({
          data: {
            action: 'media.reconcile.repair',
            metadata: {
              findingCount: findings.length,
              actionCount: actions.length,
              applied: repairOutcomes.filter((o) => o.applied).length,
              skipped: repairOutcomes.filter((o) => !o.applied).length,
              outcomes: repairOutcomes.map((o) => ({
                mediaId: o.action.mediaId,
                fromKey: o.action.fromKey,
                toKey: o.action.toKey,
                applied: o.applied,
                skippedReason: o.skippedReason ?? null,
                error: o.error ?? null,
              })),
            },
          },
        });
      }
    }

    if (args.json) {
      console.log(JSON.stringify({ findings, repairOutcomes: repairOutcomes ?? null }, null, 2));
    } else {
      printHuman(findings);
      if (repairOutcomes) {
        console.log('\nRepair outcomes:');
        for (const outcome of repairOutcomes) {
          if (outcome.applied) {
            console.log(`  MOVED: ${outcome.action.fromKey} -> ${outcome.action.toKey}`);
          } else {
            console.log(
              `  SKIPPED: ${outcome.action.fromKey} -> ${outcome.action.toKey} (${outcome.skippedReason ?? outcome.error})`,
            );
          }
        }
      }
    }

    if (hasBlockingFindings(findings)) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
