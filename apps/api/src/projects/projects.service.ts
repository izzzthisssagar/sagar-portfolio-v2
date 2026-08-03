import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EvidenceStatus, Prisma, PublicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateProjectDto,
  ListProjectsDto,
  PublicListProjectsDto,
  UpdateProjectDto,
  WorkflowTransition,
} from './projects.dto';
import { validateForPublication } from './publication-rules';

const statusToDb = (status: string) => status.toUpperCase() as PublicationStatus;

function projectView<
  T extends {
    status: PublicationStatus;
    metrics?: { evidence: EvidenceStatus }[];
    findings?: { evidenceStatus: EvidenceStatus }[];
  },
>(project: T) {
  return {
    ...project,
    status: project.status.toLowerCase(),
    ...(project.metrics
      ? { metrics: project.metrics.map((m) => ({ ...m, evidence: m.evidence.toLowerCase() })) }
      : {}),
    ...(project.findings
      ? {
          findings: project.findings.map((f) => ({
            ...f,
            evidenceStatus: f.evidenceStatus.toLowerCase(),
          })),
        }
      : {}),
  };
}

const WORKFLOW_STATUS: Record<WorkflowTransition, PublicationStatus> = {
  draft: PublicationStatus.DRAFT,
  review: PublicationStatus.REVIEW,
  publish: PublicationStatus.PUBLISHED,
  archive: PublicationStatus.ARCHIVED,
};
const WORKFLOW_AUDIT_ACTION: Record<WorkflowTransition, string> = {
  draft: 'PROJECT_UNPUBLISHED',
  review: 'PROJECT_SENT_TO_REVIEW',
  publish: 'PROJECT_PUBLISHED',
  archive: 'PROJECT_ARCHIVED',
};

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private async list(query: PublicListProjectsDto, publication?: PublicationStatus) {
    const where: Prisma.ProjectWhereInput = {
      ...(publication ? { status: publication } : {}),
      ...(query.search
        ? {
            OR: [
              { slug: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              { summary: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy = [
      { [query.sort]: query.direction },
      { id: 'asc' },
    ] as Prisma.ProjectOrderByWithRelationInput[];
    const [data, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { data: data.map(projectView), meta: { page: query.page, limit: query.limit, total } };
  }

  listPublic(query: PublicListProjectsDto) {
    return this.list(query, PublicationStatus.PUBLISHED);
  }

  listAdmin(query: ListProjectsDto) {
    return this.list(query, query.status ? statusToDb(query.status) : undefined);
  }

  async getPublicBySlug(slug: string) {
    const project = await this.prisma.project.findFirst({
      where: { slug, status: PublicationStatus.PUBLISHED },
      include: {
        // Public readers only ever see metrics with confirmed evidence — a
        // pending or unavailable metric must never read as a settled fact.
        // Findings stay unfiltered because their evidence status is
        // rendered alongside them (never presented as a bare confirmed
        // claim); the admin API and draft preview return every metric.
        metrics: { where: { evidence: EvidenceStatus.CONFIRMED }, orderBy: { order: 'asc' } },
        findings: { orderBy: { order: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return projectView(project);
  }

  async getAdmin(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        metrics: { orderBy: { order: 'asc' } },
        findings: { orderBy: { order: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return projectView(project);
  }

  async create(input: CreateProjectDto, actorId?: string) {
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        // Every project is created as DRAFT regardless of what the client
        // sends — CreateProjectDto has no `status` field, so this is the
        // only place publication status can be set on create. Publishing
        // happens exclusively through transitionStatus (the workflow
        // endpoint), which runs validateForPublication first.
        const created = await tx.project.create({
          data: { ...input, status: PublicationStatus.DRAFT },
        });
        await tx.auditLog.create({
          data: {
            action: 'PROJECT_CREATED',
            resource: 'Project',
            resourceId: created.id,
            ...(actorId ? { actorId } : {}),
          },
        });
        return created;
      });
      return projectView(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Project slug already exists');
      throw error;
    }
  }

  async update(id: string, input: UpdateProjectDto, actorId?: string) {
    const current = await this.getAdmin(id);
    // A published project must stay valid for publication after every
    // edit, not just at the moment it was published — otherwise required
    // content (overview, responsibilities/testStrategy, ...) could be
    // cleared out from under a live page via a plain PATCH. Validate the
    // merge of the stored record with the proposed change, the same way
    // transitionStatus validates before publishing; an admin who genuinely
    // wants to strip that content first sends the project back to draft.
    const currentStatus: string = current.status;
    if (currentStatus === 'published') {
      const errors = validateForPublication({ ...current, ...input });
      if (errors.length) {
        throw new BadRequestException({
          code: 'PUBLICATION_INVALID',
          message: 'This update would leave the published project without required content.',
          details: errors,
        });
      }
    }
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.project.update({ where: { id }, data: { ...input } });
        await tx.auditLog.create({
          data: {
            action: 'PROJECT_UPDATED',
            resource: 'Project',
            resourceId: id,
            ...(actorId ? { actorId } : {}),
            metadata: { changedFields: Object.keys(input) },
          },
        });
        return updated;
      });
      return projectView(project);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Project slug already exists');
      throw error;
    }
  }

  async remove(id: string, actorId?: string) {
    await this.getAdmin(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'PROJECT_DELETED',
          resource: 'Project',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }

  async transitionStatus(id: string, transition: WorkflowTransition, actorId?: string) {
    const project = await this.getAdmin(id);
    if (transition === 'publish') {
      const errors = validateForPublication(project);
      if (errors.length) {
        throw new BadRequestException({
          code: 'PUBLICATION_INVALID',
          message: 'Project is not ready to publish.',
          details: errors,
        });
      }
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.project.update({
        where: { id },
        data: {
          status: WORKFLOW_STATUS[transition],
          ...(transition === 'publish' ? { publishedAt: now } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: WORKFLOW_AUDIT_ACTION[transition],
          resource: 'Project',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { transition },
        },
      });
      return next;
    });
    return projectView(updated);
  }
}
