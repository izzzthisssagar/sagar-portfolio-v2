import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaCategory, MediaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCvDocumentDto } from './cv.dto';

@Injectable()
export class CvService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.cvDocument.findMany({
      orderBy: { createdAt: 'desc' },
      include: { media: true },
    });
  }

  async get(id: string) {
    const doc = await this.prisma.cvDocument.findUnique({
      where: { id },
      include: { media: true },
    });
    if (!doc) throw new NotFoundException('CV document not found');
    return doc;
  }

  async create(input: CreateCvDocumentDto, actorId?: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
    if (!media) throw new BadRequestException('Media asset not found.');
    if (media.category !== MediaCategory.DOCUMENT || media.status !== MediaStatus.APPROVED) {
      throw new BadRequestException({
        code: 'CV_REQUIRES_APPROVED_DOCUMENT',
        message: 'A CV must reference an approved PDF document.',
      });
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.cvDocument.create({
        data: {
          mediaId: input.mediaId,
          title: input.title,
          ...(input.versionNote !== undefined ? { versionNote: input.versionNote } : {}),
        },
        include: { media: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'CV_DOCUMENT_CREATED',
          resource: 'CvDocument',
          resourceId: doc.id,
          ...(actorId ? { actorId } : {}),
        },
      });
      return doc;
    });
    return created;
  }

  /** The `updateMany` (deactivate) + `update` (activate) pair is not, by itself, safe under
   * concurrent initial activations — two requests can both observe "no row is active" before
   * either commits. The partial unique index on `CvDocument(active) WHERE active` (migration
   * 20260803090512_cv_document_single_active_constraint) is what actually prevents two rows
   * ending up active: Postgres serializes the two transactions at the conflicting index entry,
   * lets exactly one commit, and the loser gets a unique-constraint violation here — which rolls
   * back its entire transaction (deactivation included), leaving no partial activation state. */
  async activate(id: string, actorId?: string) {
    await this.get(id);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.cvDocument.updateMany({ where: { active: true }, data: { active: false } });
        const doc = await tx.cvDocument.update({
          where: { id },
          data: { active: true },
          include: { media: true },
        });
        await tx.auditLog.create({
          data: {
            action: 'CV_ACTIVATED',
            resource: 'CvDocument',
            resourceId: id,
            ...(actorId ? { actorId } : {}),
          },
        });
        return doc;
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'CV_ACTIVATION_CONFLICT',
          message: 'Another CV activation is in progress. Retry.',
        });
      }
      throw error;
    }
  }

  /** "Archiving" an old version just means it stops being active (done via activating a
   * replacement) — this only removes the row outright, and refuses while it's still the active
   * CV so the public download route never goes from "available" to "gone" in the same request
   * that was meant to replace it. */
  async remove(id: string, actorId?: string) {
    const doc = await this.get(id);
    if (doc.active) {
      throw new ConflictException({
        code: 'CV_ACTIVE_CANNOT_DELETE',
        message: 'Activate a different CV before deleting the active one.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.cvDocument.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'CV_DOCUMENT_DELETED',
          resource: 'CvDocument',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async getActivePublic() {
    const doc = await this.prisma.cvDocument.findFirst({
      where: { active: true },
      include: { media: true },
    });
    if (!doc || doc.media.status !== MediaStatus.APPROVED) return null;
    return doc;
  }
}
