import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const accessSecret = process.env.ACCESS_TOKEN_SECRET ?? '';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? '';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? '';

async function pngBuffer(color: string): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: color } })
    .png()
    .toBuffer();
}

databaseSuite('Media pipeline: upload, validation, quarantine, approval', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let storageRoot: string;
  const adminEmail = 'media-contract-admin@example.invalid';

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'media-contract-'));
    process.env.MEDIA_STORAGE_DRIVER = 'local';
    process.env.MEDIA_STORAGE_LOCAL_PATH = storageRoot;

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Media-Contract-9!', { type: argon2.argon2id }),
      },
    });
    adminId = admin.id;
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
    await prisma.mediaAsset.deleteMany({ where: { createdById: adminId } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  it('rejects admin media routes without a token', async () => {
    await request(server()).get('/api/v1/admin/media').expect(401);
  });

  it('rejects a disguised script upload and never creates a database row for it', async () => {
    const before = await prisma.mediaAsset.count();
    await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(await prisma.mediaAsset.count()).toBe(before);
  });

  it('rejects SVG outright', async () => {
    await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
        filename: 'icon.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);
  });

  it('uploads a real image to quarantine, blocks unauthenticated approval, requires alt text, then approves', async () => {
    const buffer = await pngBuffer('#ff0000');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'evidence.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body.data.status).toBe('quarantined');
    expect(uploaded.body.data.storageKey).toMatch(/^quarantine\//);
    const id = uploaded.body.data.id as string;

    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({})
      .expect(400);

    const approved = await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'A red square used as pipeline evidence.' })
      .expect(201);
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.storageKey).toMatch(/^approved\//);
  });

  it('serves an approved image publicly with revocation-safe, ETag-validated caching', async () => {
    const buffer = await pngBuffer('#00ffff');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'public.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'A blue square used as public delivery evidence.' })
      .expect(201);

    const first = await request(server()).get(`/api/v1/media/${id}/file`).expect(200);
    // Not immutable/one-year — a database id, not a content hash, so the asset behind it can be
    // archived (revoking public availability) at any time; must-revalidate forces every repeat
    // request back to the origin instead of serving a revoked asset stale from a shared cache.
    expect(first.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(first.headers['cache-control']).not.toContain('immutable');
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    // Still-approved: a conditional request short-circuits to 304 without re-streaming.
    await request(server()).get(`/api/v1/media/${id}/file`).set('If-None-Match', etag).expect(304);

    // Archived: the exact same URL immediately 404s — no stale authorization/caching keeps
    // serving a since-revoked asset, with or without the previously-valid ETag.
    await request(server()).post(`/api/v1/admin/media/${id}/archive`).set(auth()).expect(201);
    await request(server()).get(`/api/v1/media/${id}/file`).expect(404);
    await request(server()).get(`/api/v1/media/${id}/file`).set('If-None-Match', etag).expect(404);
  });

  it('404s a quarantined, rejected, or archived image from the public file route', async () => {
    const quarantined = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#101010'), { filename: 'q.png', contentType: 'image/png' })
      .expect(201);
    await request(server()).get(`/api/v1/media/${quarantined.body.data.id}/file`).expect(404);

    const rejected = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#202020'), { filename: 'r.png', contentType: 'image/png' })
      .expect(201);
    await request(server())
      .post(`/api/v1/admin/media/${rejected.body.data.id}/reject`)
      .set(auth())
      .send({ reason: 'Not relevant.' })
      .expect(201);
    await request(server()).get(`/api/v1/media/${rejected.body.data.id}/file`).expect(404);

    const archived = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#303030'), { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    await request(server())
      .post(`/api/v1/admin/media/${archived.body.data.id}/approve`)
      .set(auth())
      .send({ altText: 'Archived-image test fixture.' })
      .expect(201);
    await request(server())
      .post(`/api/v1/admin/media/${archived.body.data.id}/archive`)
      .set(auth())
      .expect(201);
    await request(server()).get(`/api/v1/media/${archived.body.data.id}/file`).expect(404);
  });

  it('404s an approved PDF document from the generic public file route', async () => {
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
      'latin1',
    );
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', pdf, { filename: 'generic-route.pdf', contentType: 'application/pdf' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ decorative: true })
      .expect(201);

    // Approved, but a document — the generic media route only ever serves images. The admin
    // route can still stream it (behind auth), and the CV route is the only public path to a PDF.
    await request(server()).get(`/api/v1/media/${id}/file`).expect(404);
    await request(server()).get(`/api/v1/admin/media/${id}/file`).set(auth()).expect(200);
  });

  it('short-circuits a duplicate upload by checksum instead of creating a second row', async () => {
    const buffer = await pngBuffer('#00ff00');
    const first = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'dup-a.png', contentType: 'image/png' })
      .expect(201);
    const second = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'dup-b.png', contentType: 'image/png' })
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('rejects quarantined media with a reason and never makes it approvable again', async () => {
    const buffer = await pngBuffer('#0000ff');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'rejectme.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;

    await request(server())
      .post(`/api/v1/admin/media/${id}/reject`)
      .set(auth())
      .send({})
      .expect(400);
    const rejected = await request(server())
      .post(`/api/v1/admin/media/${id}/reject`)
      .set(auth())
      .send({ reason: 'Not evidence-relevant.' })
      .expect(201);
    expect(rejected.body.data.status).toBe('rejected');

    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'x' })
      .expect(400);
  });

  it('archives approved media and audits every transition', async () => {
    const buffer = await pngBuffer('#ffff00');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'archiveme.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'A yellow square.' })
      .expect(201);
    const archived = await request(server())
      .post(`/api/v1/admin/media/${id}/archive`)
      .set(auth())
      .expect(201);
    expect(archived.body.data.status).toBe('archived');

    const actions = (
      await prisma.auditLog.findMany({ where: { resourceId: id }, orderBy: { createdAt: 'asc' } })
    ).map((row) => row.action);
    expect(actions).toEqual(['MEDIA_UPLOADED', 'MEDIA_APPROVED', 'MEDIA_ARCHIVED']);
  });

  it('deletes an unattached asset, removing both the row and the stored object', async () => {
    const buffer = await pngBuffer('#ff00ff');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'deleteme.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server()).delete(`/api/v1/admin/media/${id}`).set(auth()).expect(200);
    await request(server()).get(`/api/v1/admin/media/${id}`).set(auth()).expect(404);
  });

  it('blocks deletion of media attached to a published-eligible project', async () => {
    const prefix = 'media-contract-project-';
    await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
    const buffer = await pngBuffer('#123456');
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'inuse.png', contentType: 'image/png' })
      .expect(201);
    const mediaId = uploaded.body.data.id as string;
    const project = await prisma.project.create({
      data: {
        slug: `${prefix}a`,
        title: 'Media Contract Project',
        summary: 'A project used to test media deletion blocking.',
        order: 1,
      },
    });
    await prisma.projectMedia.create({ data: { projectId: project.id, mediaId } });

    await request(server()).delete(`/api/v1/admin/media/${mediaId}`).set(auth()).expect(409);

    await prisma.projectMedia.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });
});
