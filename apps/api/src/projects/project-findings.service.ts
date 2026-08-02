import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EvidenceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectFindingDto, UpdateProjectFindingDto } from './projects.dto';

const evidenceToDb = (evidence: string) => evidence.toUpperCase() as EvidenceStatus;
const findingView = <T extends { evidenceStatus: EvidenceStatus }>(finding: T) => ({
  ...finding,
  evidenceStatus: finding.evidenceStatus.toLowerCase(),
});

@Injectable()
export class ProjectFindingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const exists = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Project not found');
  }

  private async findOwned(projectId: string, findingId: string) {
    const finding = await this.prisma.projectFinding.findFirst({
      where: { id: findingId, projectId },
    });
    if (!finding) throw new NotFoundException('Finding not found');
    return finding;
  }

  async list(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectFinding.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return rows.map(findingView);
  }

  async create(projectId: string, input: CreateProjectFindingDto, actorId?: string) {
    await this.ensureProject(projectId);
    const created = await this.prisma.$transaction(async (tx) => {
      const finding = await tx.projectFinding.create({
        data: { ...input, evidenceStatus: evidenceToDb(input.evidenceStatus), projectId },
      });
      await tx.auditLog.create({
        data: {
          action: 'FINDING_CREATED',
          resource: 'ProjectFinding',
          resourceId: finding.id,
          ...(actorId ? { actorId } : {}),
          metadata: { projectId },
        },
      });
      return finding;
    });
    return findingView(created);
  }

  async update(
    projectId: string,
    findingId: string,
    input: UpdateProjectFindingDto,
    actorId?: string,
  ) {
    await this.findOwned(projectId, findingId);
    const { evidenceStatus, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const finding = await tx.projectFinding.update({
        where: { id: findingId },
        data: { ...rest, ...(evidenceStatus ? { evidenceStatus: evidenceToDb(evidenceStatus) } : {}) },
      });
      await tx.auditLog.create({
        data: {
          action: 'FINDING_UPDATED',
          resource: 'ProjectFinding',
          resourceId: findingId,
          ...(actorId ? { actorId } : {}),
        },
      });
      return finding;
    });
    return findingView(updated);
  }

  async remove(projectId: string, findingId: string, actorId?: string) {
    await this.findOwned(projectId, findingId);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectFinding.delete({ where: { id: findingId } });
      await tx.auditLog.create({
        data: {
          action: 'FINDING_DELETED',
          resource: 'ProjectFinding',
          resourceId: findingId,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async reorder(projectId: string, orderedIds: string[], actorId?: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectFinding.findMany({
      where: { projectId },
      select: { id: true },
    });
    const validIds = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== rows.length || orderedIds.some((id) => !validIds.has(id))) {
      throw new BadRequestException({
        code: 'REORDER_INVALID',
        message: "orderedIds must contain exactly this project's finding ids.",
      });
    }
    await this.prisma.$transaction([
      ...orderedIds.map((id, index) =>
        this.prisma.projectFinding.update({ where: { id }, data: { order: index } }),
      ),
      this.prisma.auditLog.create({
        data: {
          action: 'FINDING_REORDERED',
          resource: 'Project',
          resourceId: projectId,
          ...(actorId ? { actorId } : {}),
        },
      }),
    ]);
  }
}
