import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const accessSecret = process.env.ACCESS_TOKEN_SECRET ?? '';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? '';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? '';

databaseSuite('Project content vertical: workflow, metrics, findings, dashboard', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const prefix = 'content-contract-';
  const adminEmail = 'content-contract-admin@example.invalid';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    // AuditLog.actorId carries a real foreign key to AdminUser — the token's
    // subject must reference a row that exists, not an arbitrary id.
    const admin = await prisma.adminUser.create({
      data: { email: adminEmail, passwordHash: await argon2.hash('Content-Contract-9!', { type: argon2.argon2id }) },
    });
    adminToken = new JwtService().sign(
      { sub: admin.id, role: 'admin' },
      { secret: accessSecret, issuer: accessIssuer, audience: accessAudience, algorithm: 'HS256', expiresIn: '5m' },
    );
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('refuses to publish an incomplete project and reports the missing fields', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Incomplete Project',
        slug: `${prefix}incomplete`,
        summary: 'A project missing overview and responsibilities/test strategy content.',
        status: 'draft',
        order: 1,
      })
      .expect(201);
    const id = created.body.data.id as string;

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(400);
    expect(rejected.body.error.code).toBe('PUBLICATION_INVALID');
    expect(rejected.body.error.message).toContain('not ready');
  });

  it('publishes once required fields are present, then unpublishes and archives', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Publishable Project',
        slug: `${prefix}publishable`,
        summary: 'A sufficiently detailed summary of the publishable project.',
        overview: 'Full overview text.',
        responsibilities: 'Led the QA effort end to end.',
        status: 'draft',
        order: 2,
      })
      .expect(201);
    const id = created.body.data.id as string;

    const published = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    expect(published.body.data.status).toBe('published');
    expect(published.body.data.publishedAt).toBeTruthy();

    const publicView = await request(app.getHttpServer())
      .get(`/api/v1/projects/${prefix}publishable`)
      .expect(200);
    expect(publicView.body.data.status).toBe('published');

    const unpublished = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'draft' })
      .expect(201);
    expect(unpublished.body.data.status).toBe('draft');
    await request(app.getHttpServer()).get(`/api/v1/projects/${prefix}publishable`).expect(404);

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'archive' })
      .expect(201);
    expect(archived.body.data.status).toBe('archived');

    const auditActions = (
      await prisma.auditLog.findMany({ where: { resourceId: id }, orderBy: { createdAt: 'asc' } })
    ).map((row) => row.action);
    expect(auditActions).toEqual([
      'PROJECT_CREATED',
      'PROJECT_PUBLISHED',
      'PROJECT_UNPUBLISHED',
      'PROJECT_ARCHIVED',
    ]);
  });

  it('rejects status mutation through the generic PATCH endpoint', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Patch Guard Project',
        slug: `${prefix}patch-guard`,
        summary: 'A project used to confirm status cannot be patched directly.',
        status: 'draft',
        order: 3,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${created.body.data.id}`)
      .set(auth())
      .send({ status: 'published' })
      .expect(400);
  });

  it('creates, reorders, and deletes metrics with audit events', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Metrics Project',
        slug: `${prefix}metrics`,
        summary: 'A project used to exercise the metrics vertical end to end.',
        status: 'draft',
        order: 4,
      })
      .expect(201);
    const projectId = created.body.data.id as string;

    const metricA = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Modules', value: '48', evidence: 'confirmed', order: 0 })
      .expect(201);
    const metricB = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Workspaces', value: '13', evidence: 'pending', order: 1 })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .expect(200);
    expect(list.body.data.map((m: { evidence: string }) => m.evidence)).toEqual([
      'confirmed',
      'pending',
    ]);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${projectId}/metrics/reorder`)
      .set(auth())
      .send({ orderedIds: [metricB.body.data.id, metricA.body.data.id] })
      .expect(200);
    const reordered = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .expect(200);
    expect(reordered.body.data[0].id).toBe(metricB.body.data.id);

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/projects/${projectId}/metrics/${metricA.body.data.id}`)
      .set(auth())
      .expect(200);
    expect(await prisma.projectMetric.count({ where: { projectId } })).toBe(1);

    const auditActions = (
      await prisma.auditLog.findMany({
        where: { resource: 'ProjectMetric' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(auditActions).toContain('METRIC_CREATED');
    expect(auditActions).toContain('METRIC_DELETED');
  });

  it('creates, updates, and deletes findings, keeping pending evidence distinguishable', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Findings Project',
        slug: `${prefix}findings`,
        summary: 'A project used to exercise the findings vertical end to end.',
        status: 'draft',
        order: 5,
      })
      .expect(201);
    const projectId = created.body.data.id as string;

    const finding = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/findings`)
      .set(auth())
      .send({
        title: 'Double discount applied at checkout',
        summary: 'The product discount was applied a second time during checkout totals.',
        severity: 'High',
        evidenceStatus: 'pending',
        order: 0,
      })
      .expect(201);
    expect(finding.body.data.evidenceStatus).toBe('pending');

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${projectId}/findings/${finding.body.data.id}`)
      .set(auth())
      .send({ evidenceStatus: 'unavailable' })
      .expect(200);
    expect(updated.body.data.evidenceStatus).toBe('unavailable');

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/projects/${projectId}/findings/${finding.body.data.id}`)
      .set(auth())
      .expect(200);
    expect(await prisma.projectFinding.count({ where: { projectId } })).toBe(0);
  });

  it('rejects a reorder payload that does not match the project child set', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Reorder Guard Project',
        slug: `${prefix}reorder-guard`,
        summary: 'A project used to confirm reorder payloads are validated strictly.',
        status: 'draft',
        order: 6,
      })
      .expect(201);
    const projectId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Notes', value: '876+', evidence: 'confirmed', order: 0 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${projectId}/metrics/reorder`)
      .set(auth())
      .send({ orderedIds: ['not-a-real-id'] })
      .expect(400);
  });

  it('reports live dashboard counts without inventing figures', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set(auth())
      .expect(200);
    const data = response.body.data;
    expect(typeof data.totalProjects).toBe('number');
    expect(data.projectsByStatus).toBeTypeOf('object');
    expect(typeof data.confirmedMetrics).toBe('number');
    expect(typeof data.pendingEvidence).toBe('number');
    expect(typeof data.activeSessions).toBe('number');
    expect(typeof data.unreadMessages).toBe('number');
    expect(typeof data.pendingMedia).toBe('number');
    expect(Array.isArray(data.recentAuditEvents)).toBe(true);
  });
});
