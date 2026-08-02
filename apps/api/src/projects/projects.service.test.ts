import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service';

const project = {
  id: 'p1',
  title: 'QA Mastery',
  slug: 'qa-mastery',
  summary: 'A sufficiently long factual project summary.',
  status: 'DRAFT',
  order: 1,
  overview: null,
  context: null,
  responsibilities: null,
  systemMap: null,
  testStrategy: null,
  fixAndRetest: null,
  outcome: null,
  lessons: null,
  sceneState: 'inspection',
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;
function setup() {
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    project: {
      create: vi.fn().mockResolvedValue(project),
      update: vi.fn().mockResolvedValue({ ...project, slug: 'changed' }),
      delete: vi.fn().mockResolvedValue(project),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue(project),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([project]),
      count: vi.fn().mockResolvedValue(1),
    },
    $transaction: vi.fn((value: unknown) =>
      typeof value === 'function'
        ? (value as (client: unknown) => unknown)(tx)
        : Promise.all(value as Promise<unknown>[]),
    ),
  };
  return { service: new ProjectsService(prisma as never), prisma, tx, auditCreate };
}
describe('ProjectsService', () => {
  it('paginates with a stable id tiebreaker', async () => {
    const { service, prisma } = setup();
    const result = await service.listAdmin({ page: 2, limit: 10, sort: 'order', direction: 'asc' });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1 });
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    );
  });
  it('always constrains public queries and detail to published records', async () => {
    const { service, prisma } = setup();
    await service.listPublic({ page: 1, limit: 20, sort: 'order', direction: 'asc' });
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
    await expect(service.getPublicBySlug('draft')).rejects.toThrow('Project not found');
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { slug: 'draft', status: 'PUBLISHED' },
      include: {
        metrics: { orderBy: { order: 'asc' } },
        findings: { orderBy: { order: 'asc' } },
      },
    });
  });
  it('creates, changes slug without changing identity, and deletes with audit events', async () => {
    const { service, tx, auditCreate } = setup();
    await service.create(
      {
        title: project.title,
        slug: project.slug,
        summary: project.summary,
        status: 'draft',
        order: 1,
      },
      'admin',
    );
    await service.update('p1', { slug: 'changed' }, 'admin');
    await service.remove('p1', 'admin');
    expect(tx.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ slug: 'changed' }),
      }),
    );
    expect(auditCreate.mock.calls.map((call) => call[0].data.action)).toEqual([
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_DELETED',
    ]);
  });
  it('maps duplicate slugs to HTTP 409', async () => {
    const { service, tx } = setup();
    tx.project.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );
    await expect(
      service.create({
        title: project.title,
        slug: project.slug,
        summary: project.summary,
        status: 'draft',
        order: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
