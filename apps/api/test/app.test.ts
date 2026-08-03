import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const fakePrisma = {
  project: {
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    findUnique: () => Promise.resolve(null),
    findFirst: () => Promise.resolve(null),
  },
  $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
};
describe('API v1 contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  it('exposes health and stable paginated public projects', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('ok'));
    await request(app.getHttpServer())
      .get('/api/v1/projects?page=1&limit=10&sort=title&direction=desc')
      .expect(200)
      .expect(({ body }) => expect(body.meta).toEqual({ page: 1, limit: 10, total: 0 }));
  });
  it('rejects unauthenticated project mutation without a bypass token', () =>
    request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .send({
        title: 'Test Project',
        slug: 'test-project',
        summary: 'A sufficiently long project summary.',
        status: 'draft',
        order: 2,
      })
      .expect(401));
  it('rejects an invalid login payload before provisioning response', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-email', password: 'short' })
      .expect(400));
  it('rejects unauthenticated project updates', () =>
    request(app.getHttpServer()).patch('/api/v1/admin/projects/id').send({ order: 2 }).expect(401));
});
