import 'dotenv/config';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';

/**
 * Adds representative Sprint 3 rows that `prisma/seed.ts` (seedContent) does not create, so
 * `scripts/backup-restore-rehearsal.sh` has something meaningful to back up/restore/verify beyond
 * the CMS-content-only seed: a couple of MediaAsset pipeline statuses, a CvDocument with the
 * single-active-row constraint actually exercised, and a ContactMessage with a delivery attempt.
 *
 * Idempotent: every fixture row is tagged with the MARKER prefix and deleted-then-recreated on
 * each run, so re-running this script (e.g. a second rehearsal) never accumulates duplicates.
 *
 * Deliberately does NOT create an AdminUser or RefreshSession — a restore rehearsal should never
 * need, and must never normalize, seeding fake admin credentials or sessions. See
 * docs/backup-restore.md ("what's explicitly not restored").
 */
const MARKER = 'rehearsal-fixture';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await prisma.$transaction(async (tx) => {
      // --- clean up any fixtures left by a previous run ---
      await tx.contactDeliveryAttempt.deleteMany({
        where: { contactMessage: { email: `${MARKER}@example.invalid` } },
      });
      await tx.contactMessage.deleteMany({ where: { email: `${MARKER}@example.invalid` } });
      const existingCv = await tx.cvDocument.findFirst({
        where: { title: { startsWith: MARKER } },
      });
      if (existingCv) {
        await tx.cvDocument.delete({ where: { id: existingCv.id } });
      }
      await tx.mediaAsset.deleteMany({ where: { storageKey: { startsWith: `${MARKER}/` } } });

      // --- MediaAsset fixtures across a couple of pipeline statuses (Sprint 3 media pipeline) ---
      const cvMedia = await tx.mediaAsset.create({
        data: {
          filename: 'rehearsal-cv.pdf',
          storageKey: `${MARKER}/cv.pdf`,
          mimeType: 'application/pdf',
          extension: 'pdf',
          category: 'DOCUMENT',
          byteSize: 102_400,
          sha256: 'a'.repeat(64),
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
      await tx.mediaAsset.create({
        data: {
          filename: 'rehearsal-quarantined.png',
          storageKey: `${MARKER}/quarantined.png`,
          mimeType: 'image/png',
          extension: 'png',
          category: 'IMAGE',
          byteSize: 20_480,
          sha256: 'b'.repeat(64),
          status: 'QUARANTINED',
        },
      });
      await tx.mediaAsset.create({
        data: {
          filename: 'rehearsal-rejected.png',
          storageKey: `${MARKER}/rejected.png`,
          mimeType: 'image/png',
          extension: 'png',
          category: 'IMAGE',
          byteSize: 20_480,
          sha256: 'c'.repeat(64),
          status: 'REJECTED',
          rejectionReason: 'Rehearsal fixture — synthetic rejection reason.',
          rejectedAt: new Date(),
        },
      });

      // --- CvDocument: exactly one active row, backed by the approved CV media above. Only
      // activate it if nothing else already holds the single active slot, so this script stays
      // safe to run against a not-perfectly-empty database (the partial-unique-index would
      // otherwise reject a second concurrent active row). ---
      const activeElsewhere = await tx.cvDocument.count({
        where: { active: true, NOT: { title: { startsWith: MARKER } } },
      });
      await tx.cvDocument.create({
        data: {
          mediaId: cvMedia.id,
          title: `${MARKER} — CV v1`,
          versionNote: 'Backup/restore rehearsal fixture.',
          active: activeElsewhere === 0,
        },
      });

      // --- ContactMessage + a delivery attempt (Sprint 3 contact delivery tracking) ---
      const message = await tx.contactMessage.create({
        data: {
          name: 'Rehearsal Fixture',
          email: `${MARKER}@example.invalid`,
          subject: 'Backup/restore rehearsal',
          message: 'Synthetic message created by scripts/db-rehearsal-fixtures.ts.',
          status: 'NEW',
          consentAt: new Date(),
        },
      });
      await tx.contactDeliveryAttempt.create({
        data: { contactMessageId: message.id, attemptNumber: 1, success: true },
      });
    });

    console.log(
      'Seeded rehearsal fixtures: 3 MediaAsset rows (APPROVED/QUARANTINED/REJECTED), 1 CvDocument, 1 ContactMessage + delivery attempt.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
