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

databaseSuite('Field Notes vertical: persistence, publication workflow, public visibility', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const prefix = 'field-notes-contract-';
  const adminEmail = 'field-notes-contract-admin@example.invalid';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Field-Notes-Contract-9!', { type: argon2.argon2id }),
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
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  it('rejects admin routes without a token', async () => {
    await request(server()).get('/api/v1/admin/posts').expect(401);
  });

  it('rejects a body containing raw HTML', async () => {
    await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Raw HTML body',
        slug: `${prefix}raw-html`,
        excerpt: 'An excerpt long enough to pass validation.',
        body: '<script>alert(1)</script>',
      })
      .expect(400);
  });

  it('always creates a post as draft, publishes only once required fields exist, and never re-dates publishedAt', async () => {
    const created = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Reading P95 and P99 without guessing',
        slug: `${prefix}reading-p95-p99`,
        excerpt: '',
        body: 'Real Markdown content for the article body.',
        tags: ['performance', 'testing'],
      })
      .expect(201);
    const postId = created.body.data.id as string;
    expect(created.body.data.status).toBe('draft');

    await request(server())
      .post(`/api/v1/admin/posts/${postId}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(400);

    await request(server())
      .patch(`/api/v1/admin/posts/${postId}`)
      .set(auth())
      .send({ excerpt: 'A sufficiently long excerpt for the article.' })
      .expect(200);

    const published = await request(server())
      .post(`/api/v1/admin/posts/${postId}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    const firstPublishedAt = published.body.data.publishedAt as string;
    expect(firstPublishedAt).toBeTruthy();

    await request(server())
      .post(`/api/v1/admin/posts/${postId}/workflow`)
      .set(auth())
      .send({ transition: 'archive' })
      .expect(201);
    const republished = await request(server())
      .post(`/api/v1/admin/posts/${postId}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    expect(republished.body.data.publishedAt).toBe(firstPublishedAt);
  });

  it('rejects status mutation through the generic PATCH endpoint', async () => {
    const created = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Direct status attempt',
        slug: `${prefix}direct-status`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content.',
      })
      .expect(201);
    await request(server())
      .patch(`/api/v1/admin/posts/${created.body.data.id}`)
      .set(auth())
      .send({ status: 'published' })
      .expect(400);
  });

  it('rejects a PATCH that would strip a published post of required content', async () => {
    const created = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Protected once published',
        slug: `${prefix}protected-once-published`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content long enough to publish.',
      })
      .expect(201);
    const id = created.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/posts/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    await request(server())
      .patch(`/api/v1/admin/posts/${id}`)
      .set(auth())
      .send({ excerpt: '' })
      .expect(400);
  });

  it('exposes only published posts publicly and 404s draft/review/archived by slug', async () => {
    const draft = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Still a draft',
        slug: `${prefix}still-draft`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content.',
      })
      .expect(201);
    await request(server()).get(`/api/v1/posts/${draft.body.data.slug}`).expect(404);

    const published = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Publicly visible article',
        slug: `${prefix}publicly-visible`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content long enough to publish.',
      })
      .expect(201);
    const id = published.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/posts/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    const publicGet = await request(server())
      .get(`/api/v1/posts/${published.body.data.slug}`)
      .expect(200);
    expect(publicGet.body.data.status).toBe('published');

    const list = await request(server()).get('/api/v1/posts').expect(200);
    expect(list.body.data.every((post: { status: string }) => post.status === 'published')).toBe(
      true,
    );
  });

  it('maps a duplicate slug to 409', async () => {
    await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Duplicate slug source',
        slug: `${prefix}duplicate`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content.',
      })
      .expect(201);
    await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Duplicate slug attempt',
        slug: `${prefix}duplicate`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content.',
      })
      .expect(409);
  });

  it('audits every mutation', async () => {
    const created = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Audited article',
        slug: `${prefix}audited`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Body content.',
      })
      .expect(201);
    const id = created.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/posts/${id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);
    await request(server()).delete(`/api/v1/admin/posts/${id}`).set(auth()).expect(200);
    const actions = (
      await prisma.auditLog.findMany({ where: { resourceId: id }, orderBy: { createdAt: 'asc' } })
    ).map((row) => row.action);
    expect(actions).toEqual(['POST_CREATED', 'POST_PUBLISHED', 'POST_DELETED']);
  });
});
