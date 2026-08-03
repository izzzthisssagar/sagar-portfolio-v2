import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EvidenceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectMetricDto, UpdateProjectMetricDto } from './projects.dto';

const evidenceToDb = (evidence: string) => evidence.toUpperCase() as EvidenceStatus;
const metricView = <T extends { evidence: EvidenceStatus }>(metric: T) => ({
  ...metric,
  evidence: metric.evidence.toLowerCase(),
});

@Injectable()
export class ProjectMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const exists = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Project not found');
  }

  private async findOwned(projectId: string, metricId: string) {
    const metric = await this.prisma.projectMetric.findFirst({
      where: { id: metricId, projectId },
    });
    if (!metric) throw new NotFoundException('Metric not found');
    return metric;
  }

  async list(projectId: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectMetric.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return rows.map(metricView);
  }

  async create(projectId: string, input: CreateProjectMetricDto, actorId?: string) {
    await this.ensureProject(projectId);
    const created = await this.prisma.$transaction(async (tx) => {
      const metric = await tx.projectMetric.create({
        data: { ...input, evidence: evidenceToDb(input.evidence), projectId },
      });
      await tx.auditLog.create({
        data: {
          action: 'METRIC_CREATED',
          resource: 'ProjectMetric',
          resourceId: metric.id,
          ...(actorId ? { actorId } : {}),
          metadata: { projectId },
        },
      });
      return metric;
    });
    return metricView(created);
  }

  async update(
    projectId: string,
    metricId: string,
    input: UpdateProjectMetricDto,
    actorId?: string,
  ) {
    await this.findOwned(projectId, metricId);
    const { evidence, ...rest } = input;
    const updated = await this.prisma.$transaction(async (tx) => {
      const metric = await tx.projectMetric.update({
        where: { id: metricId },
        data: { ...rest, ...(evidence ? { evidence: evidenceToDb(evidence) } : {}) },
      });
      await tx.auditLog.create({
        data: {
          action: 'METRIC_UPDATED',
          resource: 'ProjectMetric',
          resourceId: metricId,
          ...(actorId ? { actorId } : {}),
        },
      });
      return metric;
    });
    return metricView(updated);
  }

  async remove(projectId: string, metricId: string, actorId?: string) {
    await this.findOwned(projectId, metricId);
    await this.prisma.$transaction(async (tx) => {
      await tx.projectMetric.delete({ where: { id: metricId } });
      await tx.auditLog.create({
        data: {
          action: 'METRIC_DELETED',
          resource: 'ProjectMetric',
          resourceId: metricId,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async reorder(projectId: string, orderedIds: string[], actorId?: string) {
    await this.ensureProject(projectId);
    const rows = await this.prisma.projectMetric.findMany({
      where: { projectId },
      select: { id: true },
    });
    const validIds = new Set(rows.map((r) => r.id));
    const uniqueOrderedIds = new Set(orderedIds);
    // Length-only comparisons let a duplicate mask an omission (e.g. project
    // owns [A, B, C]; sending [A, A, C] has the right length and every id is
    // owned, but B was silently dropped and A silently doubled up) — the
    // uniqueness check is what actually enforces "every owned id exactly
    // once."
    const isValid =
      orderedIds.length === rows.length &&
      uniqueOrderedIds.size === orderedIds.length &&
      orderedIds.every((id) => validIds.has(id));
    if (!isValid) {
      throw new BadRequestException({
        code: 'REORDER_INVALID',
        message: "orderedIds must contain each of this project's metric ids exactly once.",
      });
    }
    await this.prisma.$transaction([
      ...orderedIds.map((id, index) =>
        this.prisma.projectMetric.update({ where: { id }, data: { order: index } }),
      ),
      this.prisma.auditLog.create({
        data: {
          action: 'METRIC_REORDERED',
          resource: 'Project',
          resourceId: projectId,
          ...(actorId ? { actorId } : {}),
        },
      }),
    ]);
  }
}
