import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EvidenceStatus, MediaStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectEvidenceDto, UpdateProjectEvidenceDto } from './project-evidence.dto';

const evidenceToDb = (status: string) => status.toUpperCase() as EvidenceStatus;
const evidenceView = <T extends { evidenceStatus: EvidenceStatus }>(row: T) => ({
  ...row,
  evidenceStatus: row.evidenceStatus.toLowerCase(),
});

@Injectable()
export class ProjectEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const exists = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Project not found');
  }

  private async findOwned(projectId: string, evidenceId: string) {
    const row = await this.prisma.projectMedia.findFirst({
      where: { id: evidenceId, projectId },
    });
    if (!row) throw new NotFoundException('Evidence not found');
    return row;
  }

  private async ensureApprovedMedia(mediaId: string) {
    const media = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!media) throw new BadRequestException('Media asset not found.');
    if (media.status !== MediaStatus.APPROVED) {
      throw new BadRequestException({
        code: 'MEDIA_NOT_APPROVED',
        message: 'Only approved media may be attached as project evidence.',
      });
    }
  }

  async list(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectMedia.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      include: { media: true },
    });
    return rows.map(evidenceView);
  }

  /** Public callers only ever see CONFIRMED evidence backed by a still-APPROVED asset — pending
   * evidence must never look confirmed, and an asset that was approved when attached but later
   * archived/rejected must not keep showing publicly. */
  async listPublicConfirmed(projectId: string) {
    const rows = await this.prisma.projectMedia.findMany({
      where: {
        projectId,
        evidenceStatus: EvidenceStatus.CONFIRMED,
        media: { status: MediaStatus.APPROVED },
      },
      orderBy: { order: 'asc' },
      include: { media: true },
    });
    return rows.map(evidenceView);
  }

  async create(projectId: string, input: CreateProjectEvidenceDto, actorId?: string) {
    await this.ensureProject(projectId);
    await this.ensureApprovedMedia(input.mediaId);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectMedia.create({
        data: { ...input, evidenceStatus: evidenceToDb(input.evidenceStatus), projectId },
        include: { media: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'EVIDENCE_CREATED',
          resource: 'ProjectMedia',
          resourceId: row.id,
          ...(actorId ? { actorId } : {}),
          metadata: { projectId, mediaId: input.mediaId },
        },
      });
      return row;
    });
    return evidenceView(created);
  }

  async update(
    projectId: string,
    evidenceId: string,
    input: UpdateProjectEvidenceDto,
    actorId?: string,
  ) {
    await this.findOwned(projectId, evidenceId);
    const { evidenceStatus, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectMedia.update({
        where: { id: evidenceId },
        data: {
          ...rest,
          ...(evidenceStatus ? { evidenceStatus: evidenceToDb(evidenceStatus) } : {}),
        },
        include: { media: true },
      });
      await tx.auditLog.create({
        data: {
          action: 'EVIDENCE_UPDATED',
          resource: 'ProjectMedia',
          resourceId: evidenceId,
          ...(actorId ? { actorId } : {}),
        },
      });
      return row;
    });
    return evidenceView(updated);
  }

  async remove(projectId: string, evidenceId: string, actorId?: string) {
    await this.findOwned(projectId, evidenceId);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectMedia.delete({ where: { id: evidenceId } });
      await tx.auditLog.create({
        data: {
          action: 'EVIDENCE_DELETED',
          resource: 'ProjectMedia',
          resourceId: evidenceId,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async reorder(projectId: string, orderedIds: string[], actorId?: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectMedia.findMany({
      where: { projectId },
      select: { id: true },
    });
    const validIds = new Set(rows.map((r) => r.id));
    const uniqueOrderedIds = new Set(orderedIds);
    const isValid =
      orderedIds.length === rows.length &&
      uniqueOrderedIds.size === orderedIds.length &&
      orderedIds.every((id) => validIds.has(id));
    if (!isValid) {
      throw new BadRequestException({
        code: 'REORDER_INVALID',
        message: "orderedIds must contain each of this project's evidence ids exactly once.",
      });
    }
    await this.prisma.$transaction([
      ...orderedIds.map((id, index) =>
        this.prisma.projectMedia.update({ where: { id }, data: { order: index } }),
      ),
      this.prisma.auditLog.create({
        data: {
          action: 'EVIDENCE_REORDERED',
          resource: 'Project',
          resourceId: projectId,
          ...(actorId ? { actorId } : {}),
        },
      }),
    ]);
  }
}
