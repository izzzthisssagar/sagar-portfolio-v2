import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PublicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateProjectDto,
  ListProjectsDto,
  PublicListProjectsDto,
  UpdateProjectDto,
} from './projects.dto';

const statusToDb = (status: string) => status.toUpperCase() as PublicationStatus;
const projectView = <T extends { status: PublicationStatus }>(project: T) => ({
  ...project,
  status: project.status.toLowerCase(),
});

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
    });
    if (!project) throw new NotFoundException('Project not found');
    return projectView(project);
  }

  async getAdmin(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return projectView(project);
  }

  async create(input: CreateProjectDto, actorId?: string) {
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: { ...input, status: statusToDb(input.status) },
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
    await this.getAdmin(id);
    const { status, ...fields } = input;
    try {
      const project = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.project.update({
          where: { id },
          data: { ...fields, ...(status ? { status: statusToDb(status) } : {}) },
        });
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
}
