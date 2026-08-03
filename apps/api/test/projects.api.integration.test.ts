import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PublicationStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const accessSecret = process.env.ACCESS_TOKEN_SECRET ?? '';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? '';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? '';
const adminEmail = 'publication-contract-admin@example.invalid';
databaseSuite('Project publication API boundary', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const prefix = 'publication-contract-';
  const ids = new Map<PublicationStatus, string>();

  beforeAll(async () => {
    if (!accessSecret || !accessIssuer || !accessAudience) {
      throw new Error('JWT test configuration is required');
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
    for (const [index, status] of Object.values(PublicationStatus).entries()) {
      const record = await prisma.project.create({
        data: {
          title: `${status} Project`,
          slug: `${prefix}${status.toLowerCase()}`,
          summary: `A ${status.toLowerCase()} project used to verify the publication boundary.`,
          status,
          order: 900 + index,
        },
      });
      ids.set(status, record.id);
    }
    // JwtAuthGuard checks the token's `sub` against a real AdminUser row and
    // its tokenVersion — a token for a nonexistent admin id is now rejected.
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: { email: adminEmail, passwordHash: 'not-used-in-this-suite' },
    });
    adminToken = new JwtService().sign(
      { sub: admin.id, role: 'admin', tokenVersion: admin.tokenVersion },
      {
        secret: accessSecret,
        issuer: accessIssuer,
        audience: accessAudience,
        algorithm: 'HS256',
        expiresIn: '5m',
      },
    );
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('returns only published projects publicly', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/projects?search=${prefix}`)
      .expect(200);
    expect(response.body.data.map((project: { status: string }) => project.status)).toEqual([
      'published',
    ]);
    expect(response.body.data[0].id).toBe(ids.get(PublicationStatus.PUBLISHED));
  });

  it.each(['draft', 'review', 'archived'])(
    'does not expose %s projects publicly',
    async (status) => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/projects?search=${prefix}${status}`)
        .expect(200);
      expect(response.body.data).toEqual([]);
    },
  );

  it('returns 404 for an unpublished public slug and rejects status filter bypasses', async () => {
    await request(app.getHttpServer()).get(`/api/v1/projects/${prefix}draft`).expect(404);
    await request(app.getHttpServer()).get('/api/v1/projects?status=draft').expect(400);
  });

  it('lets an authenticated admin retrieve a draft by id', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${ids.get(PublicationStatus.DRAFT)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('draft'));
  });

  it('rejects an unauthenticated admin project request', () =>
    request(app.getHttpServer()).get('/api/v1/admin/projects').expect(401));
});
