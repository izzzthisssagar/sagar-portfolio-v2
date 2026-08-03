import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaCategory, MediaStatus, Prisma, type MediaAsset } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import type { ApproveMediaDto, ListMediaDto, RejectMediaDto, UpdateMediaDto } from './media.dto';
import { normalizeFilenameForDisplay, storageKey, validateUpload } from './media-validation';
import { MEDIA_STORAGE, type MediaStorageAdapter } from './storage/storage-adapter.interface';

const REJECTION_MESSAGE: Record<string, string> = {
  UNRECOGNIZED_FILE_TYPE: 'The file could not be identified as an allowed type.',
  DISALLOWED_TYPE:
    'This file type is not allowed. Allowed: JPEG, PNG, WebP, AVIF images or PDF documents.',
  EXTENSION_MISMATCH: "The file's extension does not match its actual content.",
  OVERSIZE: 'This file exceeds the configured size limit for its category.',
  ENCRYPTED_PDF: 'Password-protected PDFs are not accepted.',
};

const statusToDb = (status: string) => status.toUpperCase() as MediaStatus;

/** Takes the concrete `MediaAsset` type (not a generic parameter) deliberately — spreading a
 * generic object type in TS intersects rather than overrides duplicate keys, which would leave
 * `status`/`category` typed as the uppercase Prisma enum instead of the lowercased string this
 * actually returns. */
function mediaView(media: MediaAsset) {
  return { ...media, status: media.status.toLowerCase(), category: media.category.toLowerCase() };
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorageAdapter,
  ) {}

  async list(query: ListMediaDto) {
    const where: Prisma.MediaAssetWhereInput = {
      ...(query.status ? { status: statusToDb(query.status) } : {}),
      ...(query.category ? { category: query.category.toUpperCase() as MediaCategory } : {}),
      ...(query.search
        ? { filename: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);
    return { data: data.map(mediaView), meta: { page: query.page, limit: query.limit, total } };
  }

  async get(id: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media asset not found');
    return mediaView(media);
  }

  /** Admin-only preview stream — deliberately separate from the public delivery route (which
   * only ever serves APPROVED assets, unauthenticated, with different caching/header rules). An
   * administrator reviewing the quarantine queue needs to see a still-QUARANTINED or REJECTED
   * file too, behind JwtAuthGuard, never behind a public URL. */
  async getFile(id: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media asset not found');
    const buffer = await this.storage.get(media.storageKey);
    return { buffer, mimeType: media.mimeType, filename: media.filename };
  }

  /** Public counterpart to `getFile` — returns null (never throws) for anything that isn't
   * APPROVED, so `PublicMediaController` can 404 without distinguishing "doesn't exist" from
   * "exists but not public" to the caller. */
  async getApprovedFile(
    id: string,
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!media || media.status !== MediaStatus.APPROVED) return null;
    const buffer = await this.storage.get(media.storageKey);
    return { buffer, mimeType: media.mimeType, filename: media.filename };
  }

  async upload(file: { buffer: Buffer; originalname: string; mimetype: string }, actorId?: string) {
    const result = await validateUpload(file.buffer, file.originalname, file.mimetype);
    if (!result.ok) {
      throw new BadRequestException({
        code: `MEDIA_${result.reason}`,
        message: REJECTION_MESSAGE[result.reason] ?? 'This file was rejected.',
      });
    }
    const { category, mimeType, extension, sha256 } = result.file;

    const existing = await this.prisma.mediaAsset.findFirst({ where: { sha256 } });
    if (existing) return mediaView(existing);

    let body = file.buffer;
    let width: number | undefined;
    let height: number | undefined;
    if (category === 'IMAGE') {
      // Re-encoding through sharp (rather than storing the uploaded bytes verbatim) strips
      // embedded metadata (EXIF/ICC/XMP) as a side effect of decode+re-encode, on top of the
      // explicit .rotate() bake-in — sharp's default output already omits source metadata
      // unless .withMetadata() is called.
      const pipeline = sharp(file.buffer).rotate();
      body = await pipeline.toBuffer();
      const info = await sharp(body).metadata();
      width = info.width;
      height = info.height;
    }

    const key = storageKey('quarantine', sha256, extension);
    await this.storage.put(key, body, mimeType);

    const created = await this.prisma.$transaction(async (tx) => {
      const media = await tx.mediaAsset.create({
        data: {
          filename: normalizeFilenameForDisplay(file.originalname),
          storageKey: key,
          mimeType,
          extension,
          category,
          byteSize: body.byteLength,
          sha256,
          status: MediaStatus.QUARANTINED,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
          ...(actorId ? { createdById: actorId } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_UPLOADED',
          resource: 'MediaAsset',
          resourceId: media.id,
          ...(actorId ? { actorId } : {}),
          metadata: { category, mimeType, byteSize: body.byteLength },
        },
      });
      return media;
    });
    return mediaView(created);
  }

  async update(id: string, input: UpdateMediaDto, actorId?: string) {
    await this.get(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const media = await tx.mediaAsset.update({ where: { id }, data: { ...input } });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_UPDATED',
          resource: 'MediaAsset',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { changedFields: Object.keys(input) },
        },
      });
      return media;
    });
    return mediaView(updated);
  }

  async approve(id: string, input: ApproveMediaDto, actorId?: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media asset not found');
    if (media.status !== MediaStatus.QUARANTINED) {
      throw new BadRequestException('Only quarantined media can be approved.');
    }
    const altText = input.altText ?? media.altText;
    const decorative = input.decorative ?? media.decorative;
    if (media.category === 'IMAGE' && !decorative && !altText?.trim()) {
      throw new BadRequestException({
        code: 'MEDIA_ALT_TEXT_REQUIRED',
        message: 'Alt text is required for a content-bearing image (or mark it decorative).',
      });
    }

    const nextKey = storageKey('approved', media.sha256, media.extension);
    // Move the object before touching the database — if the move fails, the row stays
    // QUARANTINED rather than recording an approval that isn't actually servable.
    await this.storage.move(media.storageKey, nextKey);
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.mediaAsset.update({
        where: { id },
        data: {
          status: MediaStatus.APPROVED,
          approvedAt: new Date(),
          storageKey: nextKey,
          ...(input.altText !== undefined ? { altText: input.altText } : {}),
          ...(input.decorative !== undefined ? { decorative: input.decorative } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_APPROVED',
          resource: 'MediaAsset',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
      return next;
    });
    return mediaView(updated);
  }

  async reject(id: string, input: RejectMediaDto, actorId?: string) {
    const media = await this.get(id);
    if (media.status !== 'quarantined') {
      throw new BadRequestException('Only quarantined media can be rejected.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.mediaAsset.update({
        where: { id },
        data: {
          status: MediaStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: input.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_REJECTED',
          resource: 'MediaAsset',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { reason: input.reason },
        },
      });
      return next;
    });
    return mediaView(updated);
  }

  async archive(id: string, actorId?: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!media) throw new NotFoundException('Media asset not found');
    if (media.status !== MediaStatus.APPROVED) {
      throw new BadRequestException('Only approved media can be archived.');
    }
    const nextKey = storageKey('archived', media.sha256, media.extension);
    await this.storage.move(media.storageKey, nextKey);
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.mediaAsset.update({
        where: { id },
        data: { status: MediaStatus.ARCHIVED, storageKey: nextKey },
      });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_ARCHIVED',
          resource: 'MediaAsset',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
      return next;
    });
    return mediaView(updated);
  }

  async remove(id: string, actorId?: string) {
    const media = await this.prisma.mediaAsset.findUnique({
      where: { id },
      include: {
        projects: true,
        socialFor: true,
        featuredFor: true,
        portraitFor: true,
        cvDocument: true,
      },
    });
    if (!media) throw new NotFoundException('Media asset not found');
    const inUse =
      media.projects.length > 0 ||
      media.socialFor.length > 0 ||
      media.featuredFor.length > 0 ||
      media.portraitFor.length > 0 ||
      media.cvDocument !== null;
    if (inUse) {
      throw new ConflictException({
        code: 'MEDIA_IN_USE',
        message:
          'This media asset is attached to a project, post, portrait, or CV document. Detach it before deleting.',
      });
    }
    // Storage delete first: if it fails, the DB row (and thus the still-quarantined/approved
    // file) remains intact and retryable, rather than leaving an orphaned object with no
    // database record.
    await this.storage.delete(media.storageKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAsset.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'MEDIA_DELETED',
          resource: 'MediaAsset',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }
}
