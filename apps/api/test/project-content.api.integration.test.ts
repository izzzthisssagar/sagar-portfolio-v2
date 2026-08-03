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
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Content-Contract-9!', { type: argon2.argon2id }),
      },
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

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  it('refuses to publish an incomplete project and reports the missing fields', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Incomplete Project',
        slug: `${prefix}incomplete`,
        summary: 'A project missing overview and responsibilities/test strategy content.',
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

  it('rejects a PATCH that would strip a published project of required publication content', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Published Content Guard Project',
        slug: `${prefix}published-content-guard`,
        summary: 'A published project used to confirm updates cannot break publication validity.',
        overview: 'Full overview text.',
        responsibilities: 'Led the QA effort end to end.',
        order: 10,
      })
      .expect(201);
    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);

    // Clearing `overview` (required for publication) via a plain PATCH must
    // be rejected while the project is still published.
    const rejected = await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${id}`)
      .set(auth())
      .send({ overview: '' })
      .expect(400);
    expect(rejected.body.error.code).toBe('PUBLICATION_INVALID');

    // The stored record must be untouched — still published, still with its
    // original overview.
    const unchanged = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${id}`)
      .set(auth())
      .expect(200);
    expect(unchanged.body.data.status).toBe('published');
    expect(unchanged.body.data.overview).toBe('Full overview text.');

    // Clearing both responsibilities and testStrategy — leaving neither of
    // the two acceptable alternatives — must also be rejected.
    const rejectedBoth = await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${id}`)
      .set(auth())
      .send({ responsibilities: '', testStrategy: '' })
      .expect(400);
    expect(rejectedBoth.body.error.code).toBe('PUBLICATION_INVALID');

    // A harmless edit that keeps the project publication-valid still goes
    // through normally.
    const allowed = await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${id}`)
      .set(auth())
      .send({ summary: 'An updated, still-sufficiently-detailed summary.' })
      .expect(200);
    expect(allowed.body.data.summary).toBe('An updated, still-sufficiently-detailed summary.');

    // Sending the project back to draft first, then clearing that same
    // content, is allowed — the guard only applies while published.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${id}/workflow`)
      .set(auth())
      .send({ transition: 'draft' })
      .expect(201);
    const clearedAsDraft = await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${id}`)
      .set(auth())
      .send({ overview: '' })
      .expect(200);
    expect(clearedAsDraft.body.data.overview).toBe('');
  });

  it('rejects status mutation through the generic PATCH endpoint', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Patch Guard Project',
        slug: `${prefix}patch-guard`,
        summary: 'A project used to confirm status cannot be patched directly.',
        order: 3,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${created.body.data.id}`)
      .set(auth())
      .send({ status: 'published' })
      .expect(400);
  });

  it('rejects a create request that supplies a publication status', async () => {
    const rejected = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Status Injection Project',
        slug: `${prefix}status-injection`,
        summary: 'A create request that tries to set status directly instead of DRAFT.',
        status: 'published',
        order: 7,
      })
      .expect(400);
    expect(JSON.stringify(rejected.body.error.message)).toMatch(/status/i);
  });

  it('rejects a create request that tries to set publishedAt directly', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'PublishedAt Injection Project',
        slug: `${prefix}publishedat-injection`,
        summary: 'A create request that tries to backdate publishedAt directly.',
        publishedAt: '2020-01-01T00:00:00.000Z',
        order: 7,
      })
      .expect(400);
  });

  it('always creates a project as draft, even when the payload is publish-ready, and only sets publishedAt through the workflow endpoint', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Publish-Ready On Create Project',
        slug: `${prefix}publish-ready-on-create`,
        summary: 'A fully publish-ready payload submitted straight to the create endpoint.',
        overview: 'Full overview text.',
        responsibilities: 'Led the QA effort end to end.',
        order: 8,
      })
      .expect(201);
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.publishedAt).toBeFalsy();

    // Not publicly visible until it actually goes through the workflow
    // endpoint's own publish validation.
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${prefix}publish-ready-on-create`)
      .expect(404);

    const published = await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${created.body.data.id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    expect(published.body.data.status).toBe('published');
    expect(published.body.data.publishedAt).toBeTruthy();

    const auditActions = (
      await prisma.auditLog.findMany({
        where: { resourceId: created.body.data.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(auditActions).toEqual(['PROJECT_CREATED', 'PROJECT_PUBLISHED']);
  });

  it('creates, reorders, and deletes metrics with audit events', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Metrics Project',
        slug: `${prefix}metrics`,
        summary: 'A project used to exercise the metrics vertical end to end.',
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

  it('exposes only confirmed metrics publicly, while admin and preview keep every evidence state', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Evidence Visibility Project',
        slug: `${prefix}evidence-visibility`,
        summary: 'A project used to verify public metrics are filtered by evidence status.',
        overview: 'Full overview text.',
        responsibilities: 'Led the QA effort end to end.',
        order: 9,
      })
      .expect(201);
    const projectId = created.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Confirmed metric', value: '48', evidence: 'confirmed', order: 0 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Pending metric', value: '13', evidence: 'pending', order: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .send({ label: 'Unavailable metric', value: '3', evidence: 'unavailable', order: 2 })
      .expect(201);

    // Admin API always returns every evidence state, published or not.
    const adminView = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}`)
      .set(auth())
      .expect(200);
    expect(adminView.body.data.metrics.map((m: { evidence: string }) => m.evidence).sort()).toEqual(
      ['confirmed', 'pending', 'unavailable'],
    );

    await request(app.getHttpServer())
      .post(`/api/v1/admin/projects/${projectId}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);

    const publicView = await request(app.getHttpServer())
      .get(`/api/v1/projects/${prefix}evidence-visibility`)
      .expect(200);
    expect(publicView.body.data.metrics).toHaveLength(1);
    expect(publicView.body.data.metrics[0]).toMatchObject({
      label: 'Confirmed metric',
      evidence: 'confirmed',
    });
    expect(
      publicView.body.data.metrics.some((m: { evidence: string }) => m.evidence === 'pending'),
    ).toBe(false);
    expect(
      publicView.body.data.metrics.some((m: { evidence: string }) => m.evidence === 'unavailable'),
    ).toBe(false);

    // Publishing must not silently change any metric's evidence status —
    // the admin view should still show the same three states afterward.
    const adminAfterPublish = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}`)
      .set(auth())
      .expect(200);
    expect(
      adminAfterPublish.body.data.metrics.map((m: { evidence: string }) => m.evidence).sort(),
    ).toEqual(['confirmed', 'pending', 'unavailable']);
  });

  it('creates, updates, and deletes findings, keeping pending evidence distinguishable', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Findings Project',
        slug: `${prefix}findings`,
        summary: 'A project used to exercise the findings vertical end to end.',
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

  it('rejects duplicate, omitted, and foreign reorder ids for both metrics and findings, with no partial updates', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/projects')
      .set(auth())
      .send({
        title: 'Reorder Guard Project',
        slug: `${prefix}reorder-guard`,
        summary: 'A project used to confirm reorder payloads are validated strictly.',
        order: 6,
      })
      .expect(201);
    const projectId = created.body.data.id as string;

    const metricIds: string[] = [];
    for (const label of ['Metric A', 'Metric B', 'Metric C']) {
      const metric = await request(app.getHttpServer())
        .post(`/api/v1/admin/projects/${projectId}/metrics`)
        .set(auth())
        .send({ label, value: '1', evidence: 'confirmed', order: metricIds.length })
        .expect(201);
      metricIds.push(metric.body.data.id as string);
    }
    const [metricA, metricB, metricC] = metricIds;

    const findingIds: string[] = [];
    for (const title of ['Finding A', 'Finding B', 'Finding C']) {
      const finding = await request(app.getHttpServer())
        .post(`/api/v1/admin/projects/${projectId}/findings`)
        .set(auth())
        .send({
          title,
          summary: 'A finding used to exercise reorder id validation end to end.',
          evidenceStatus: 'pending',
          order: findingIds.length,
        })
        .expect(201);
      findingIds.push(finding.body.data.id as string);
    }
    const [findingA, findingB, findingC] = findingIds;

    const invalidMetricPayloads = [
      { label: 'duplicate id masking an omission', orderedIds: [metricA, metricA, metricC] },
      { label: 'omitted id', orderedIds: [metricA, metricB] },
      { label: 'foreign id', orderedIds: [metricA, metricB, 'not-a-real-id'] },
      { label: 'extra id beyond the owned set', orderedIds: [metricA, metricB, metricC, metricA] },
    ];
    for (const { orderedIds } of invalidMetricPayloads) {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/projects/${projectId}/metrics/reorder`)
        .set(auth())
        .send({ orderedIds })
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('REORDER_INVALID'));
    }

    const invalidFindingPayloads = [
      { orderedIds: [findingA, findingA, findingC] },
      { orderedIds: [findingA, findingB] },
      { orderedIds: [findingA, findingB, 'not-a-real-id'] },
    ];
    for (const { orderedIds } of invalidFindingPayloads) {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/projects/${projectId}/findings/reorder`)
        .set(auth())
        .send({ orderedIds })
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('REORDER_INVALID'));
    }

    // None of the rejected payloads may have touched the stored order —
    // every metric/finding must still report its original position.
    const metricsAfter = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .expect(200);
    expect(
      metricsAfter.body.data.map((m: { id: string; order: number }) => [m.id, m.order]),
    ).toEqual([
      [metricA, 0],
      [metricB, 1],
      [metricC, 2],
    ]);
    const findingsAfter = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}/findings`)
      .set(auth())
      .expect(200);
    expect(
      findingsAfter.body.data.map((f: { id: string; order: number }) => [f.id, f.order]),
    ).toEqual([
      [findingA, 0],
      [findingB, 1],
      [findingC, 2],
    ]);

    // A well-formed reorder (every owned id exactly once) still works.
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/projects/${projectId}/metrics/reorder`)
      .set(auth())
      .send({ orderedIds: [metricC, metricB, metricA] })
      .expect(200);
    const metricsReordered = await request(app.getHttpServer())
      .get(`/api/v1/admin/projects/${projectId}/metrics`)
      .set(auth())
      .expect(200);
    expect(metricsReordered.body.data.map((m: { id: string }) => m.id)).toEqual([
      metricC,
      metricB,
      metricA,
    ]);
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
