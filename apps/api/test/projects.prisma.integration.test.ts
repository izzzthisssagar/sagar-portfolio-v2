import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProjectsService } from '../src/projects/projects.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
databaseSuite('Projects Prisma integration', () => {
  let prisma: PrismaService;
  let service: ProjectsService;
  const slug = 'integration-project-contract';
  let id: string;
  beforeAll(async () => {
    prisma = new PrismaService();
    service = new ProjectsService(prisma);
    await prisma.$connect();
    await prisma.project.deleteMany({ where: { slug } });
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { slug } });
    await prisma.$disconnect();
  });
  it('persists create, update, pagination and delete with audit events', async () => {
    const created = await service.create({
      title: 'Integration Project',
      slug,
      summary: 'A database-backed integration project contract.',
      status: 'draft',
      order: 999,
    });
    id = created.id;
    expect(
      (
        await service.listAdmin({
          page: 1,
          limit: 10,
          status: 'draft',
          search: 'Integration',
          sort: 'order',
          direction: 'asc',
        })
      ).data.some((item) => item.id === id),
    ).toBe(true);
    expect((await service.update(id, { title: 'Integration Project Updated' })).title).toBe(
      'Integration Project Updated',
    );
    await service.remove(id);
    expect(await prisma.auditLog.count({ where: { resourceId: id } })).toBe(3);
  });
});
