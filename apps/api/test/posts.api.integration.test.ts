import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import sharp from 'sharp';
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

  // Trailing bytes appended after a PNG's IEND chunk (or a PDF's %%EOF) don't affect decoding —
  // ignored by both `file-type`'s magic-byte sniffing and sharp's decoder — but they do change
  // the upload's SHA-256, which the media pipeline dedupes by. Embedding this file's own
  // `prefix` guarantees these fixtures can never collide with another integration test file's
  // fixture content sharing the same nominal seed counter, even when the whole suite runs
  // sequentially against one shared database (see media.api/dashboard.api/portrait-cv.api tests).
  let imageSeed = 0;
  async function uploadApprovedImage() {
    imageSeed += 1;
    const base = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#3355ff' },
    })
      .png()
      .toBuffer();
    const buffer = Buffer.concat([base, Buffer.from(`${prefix}featured-${imageSeed}`)]);
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'featured.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'A test featured image.' })
      .expect(201);
    return id;
  }

  async function uploadQuarantinedImage() {
    imageSeed += 1;
    const base = await sharp({
      create: { width: 20, height: 4, channels: 3, background: '#112233' },
    })
      .png()
      .toBuffer();
    const buffer = Buffer.concat([base, Buffer.from(`${prefix}quarantined-${imageSeed}`)]);
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'quarantined-featured.png', contentType: 'image/png' })
      .expect(201);
    return uploaded.body.data.id as string;
  }

  let pdfSeed = 0;
  async function uploadApprovedPdf() {
    pdfSeed += 1;
    const pdf = Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Seed ${prefix}${pdfSeed}>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
      'latin1',
    );
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', pdf, { filename: `featured-${pdfSeed}.pdf`, contentType: 'application/pdf' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ decorative: true })
      .expect(201);
    return id;
  }

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

  describe('featured image validation', () => {
    it('rejects an unapproved (quarantined) featured image on create', async () => {
      const featuredImageId = await uploadQuarantinedImage();
      await request(server())
        .post('/api/v1/admin/posts')
        .set(auth())
        .send({
          title: 'Unapproved featured image',
          slug: `${prefix}unapproved-featured`,
          excerpt: 'A sufficiently long excerpt for the article.',
          body: 'Body content.',
          featuredImageId,
        })
        .expect(400);
    });

    it('rejects a PDF as a featured image on create', async () => {
      const featuredImageId = await uploadApprovedPdf();
      await request(server())
        .post('/api/v1/admin/posts')
        .set(auth())
        .send({
          title: 'PDF featured image',
          slug: `${prefix}pdf-featured`,
          excerpt: 'A sufficiently long excerpt for the article.',
          body: 'Body content.',
          featuredImageId,
        })
        .expect(400);
    });

    it('accepts an approved image as a featured image on create', async () => {
      const featuredImageId = await uploadApprovedImage();
      const created = await request(server())
        .post('/api/v1/admin/posts')
        .set(auth())
        .send({
          title: 'Approved featured image',
          slug: `${prefix}approved-featured`,
          excerpt: 'A sufficiently long excerpt for the article.',
          body: 'Body content.',
          featuredImageId,
        })
        .expect(201);
      expect(created.body.data.featuredImage.id).toBe(featuredImageId);
    });

    it('rejects patching a published post to an invalid featured image, leaving the stored record unchanged', async () => {
      const goodImageId = await uploadApprovedImage();
      const created = await request(server())
        .post('/api/v1/admin/posts')
        .set(auth())
        .send({
          title: 'Published, then bad featured-image patch',
          slug: `${prefix}published-bad-featured-patch`,
          excerpt: 'A sufficiently long excerpt for the article.',
          body: 'Body content long enough to publish.',
          featuredImageId: goodImageId,
        })
        .expect(201);
      const id = created.body.data.id as string;
      await request(server())
        .post(`/api/v1/admin/posts/${id}/workflow`)
        .set(auth())
        .send({ transition: 'publish' })
        .expect(201);

      const badImageId = await uploadQuarantinedImage();
      await request(server())
        .patch(`/api/v1/admin/posts/${id}`)
        .set(auth())
        .send({ featuredImageId: badImageId })
        .expect(400);

      const after = await request(server())
        .get(`/api/v1/admin/posts/${id}`)
        .set(auth())
        .expect(200);
      expect(after.body.data.featuredImageId).toBe(goodImageId);
      expect(after.body.data.status).toBe('published');
    });

    it("never exposes a featured image on the public post once it's archived or rejected", async () => {
      const featuredImageId = await uploadApprovedImage();
      const created = await request(server())
        .post('/api/v1/admin/posts')
        .set(auth())
        .send({
          title: 'Featured image later archived',
          slug: `${prefix}featured-later-archived`,
          excerpt: 'A sufficiently long excerpt for the article.',
          body: 'Body content long enough to publish.',
          featuredImageId,
        })
        .expect(201);
      const id = created.body.data.id as string;
      await request(server())
        .post(`/api/v1/admin/posts/${id}/workflow`)
        .set(auth())
        .send({ transition: 'publish' })
        .expect(201);

      const beforeArchive = await request(server())
        .get(`/api/v1/posts/${created.body.data.slug}`)
        .expect(200);
      expect(beforeArchive.body.data.featuredImage.id).toBe(featuredImageId);

      await request(server())
        .post(`/api/v1/admin/media/${featuredImageId}/archive`)
        .set(auth())
        .expect(201);

      const afterArchive = await request(server())
        .get(`/api/v1/posts/${created.body.data.slug}`)
        .expect(200);
      expect(afterArchive.body.data.featuredImage).toBeNull();

      // The admin/preview view, by contrast, still shows it — the CMS needs to see the broken
      // reference to fix it, unlike the public page.
      const adminView = await request(server())
        .get(`/api/v1/admin/posts/${id}`)
        .set(auth())
        .expect(200);
      expect(adminView.body.data.featuredImage.id).toBe(featuredImageId);
    });
  });
});
