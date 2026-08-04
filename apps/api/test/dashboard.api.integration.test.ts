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

/**
 * Some dashboard fields (`activeCvConfigured`, `activePortraitConfigured`) reflect a single
 * global row (`Profile`, the active `CvDocument`) shared across every suite, so this file
 * captures and restores that state around its own assertions rather than asserting an absolute
 * value — the same discipline `portrait-cv.api.integration.test.ts` already applies. Everything
 * else (post/media/notification counts) is asserted as a before/after delta, which stays correct
 * regardless of what other suites have left behind.
 */
databaseSuite('Dashboard: live operational counts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let profileId: string;
  let originalPortraitMediaId: string | null;
  const prefix = 'dashboard-contract-';
  const adminEmail = 'dashboard-contract-admin@example.invalid';

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
        passwordHash: await argon2.hash('Dashboard-Contract-9!', { type: argon2.argon2id }),
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
    // The real content seed (idempotent — prisma/seed-content.ts) may not have run yet at this
    // point in CI (it runs after `pnpm test`, not before), so this can't assume a Profile row
    // already exists. A minimal fixture row is created only if none does; the seed step later
    // in the same CI job updates it in place to the real content regardless of which ran first.
    const profile =
      (await prisma.profile.findFirst()) ??
      (await prisma.profile.create({
        data: {
          name: 'Dashboard Test Fixture',
          headline: 'Test fixture headline',
          bio: 'Created by dashboard.api.integration.test.ts — no Profile row existed yet.',
          location: 'Test fixture',
          availability: 'Test fixture',
        },
      }));
    profileId = profile.id;
    originalPortraitMediaId = profile.portraitMediaId;
  });

  afterAll(async () => {
    await prisma.profile.update({
      where: { id: profileId },
      data: { portraitMediaId: originalPortraitMediaId },
    });
    await prisma.contactDeliveryAttempt.deleteMany({
      where: { contactMessage: { email: { contains: prefix } } },
    });
    await prisma.contactMessage.deleteMany({ where: { email: { contains: prefix } } });
    await prisma.cvDocument.deleteMany({ where: { media: { createdById: adminId } } });
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.mediaAsset.deleteMany({ where: { createdById: adminId } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  async function summary() {
    const res = await request(server()).get('/api/v1/admin/dashboard').set(auth()).expect(200);
    return res.body.data;
  }

  let imageSeed = 0;
  async function uploadImage(status: 'approve' | 'reject') {
    imageSeed += 1;
    const buffer = await sharp({
      create: { width: 4 + imageSeed, height: 4, channels: 3, background: '#3355ff' },
    })
      .png()
      .toBuffer();
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: `${prefix}${imageSeed}.png`, contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    if (status === 'approve') {
      await request(server())
        .post(`/api/v1/admin/media/${id}/approve`)
        .set(auth())
        .send({ altText: 'Dashboard fixture image.' })
        .expect(201);
    } else {
      await request(server())
        .post(`/api/v1/admin/media/${id}/reject`)
        .set(auth())
        .send({ reason: 'Dashboard fixture — deliberately rejected.' })
        .expect(201);
    }
    return id;
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
      .attach('file', pdf, { filename: `${prefix}${pdfSeed}.pdf`, contentType: 'application/pdf' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ decorative: true })
      .expect(201);
    return id;
  }

  it('rejects the dashboard route without a token', async () => {
    await request(server()).get('/api/v1/admin/dashboard').expect(401);
  });

  it('counts published and draft posts', async () => {
    const before = await summary();

    const draft = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Dashboard draft post',
        slug: `${prefix}draft`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Draft body content.',
      })
      .expect(201);
    expect(draft.body.data.status).toBe('draft');

    const toPublish = await request(server())
      .post('/api/v1/admin/posts')
      .set(auth())
      .send({
        title: 'Dashboard published post',
        slug: `${prefix}published`,
        excerpt: 'A sufficiently long excerpt for the article.',
        body: 'Published body content.',
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/admin/posts/${toPublish.body.data.id}/workflow`)
      .set(auth())
      .send({ transition: 'publish' })
      .expect(201);

    const after = await summary();
    expect(after.draftPosts - before.draftPosts).toBe(1);
    expect(after.publishedPosts - before.publishedPosts).toBe(1);
  });

  it('counts quarantined and rejected media separately', async () => {
    const before = await summary();
    await uploadImage('reject');
    const after = await summary();
    expect(after.rejectedMedia - before.rejectedMedia).toBe(1);
    expect(after.pendingMedia).toBe(before.pendingMedia);
  });

  it('counts failed notification delivery attempts', async () => {
    const before = await summary();
    const message = await prisma.contactMessage.create({
      data: {
        name: 'Dashboard Fixture',
        email: `${prefix}failure@example.invalid`,
        message: 'Fixture message for a failed delivery attempt.',
        consentAt: new Date(),
      },
    });
    await prisma.contactDeliveryAttempt.create({
      data: {
        contactMessageId: message.id,
        attemptNumber: 1,
        success: false,
        reason: 'SMTP fixture failure.',
      },
    });
    const after = await summary();
    expect(after.failedNotifications - before.failedNotifications).toBe(1);
  });

  it('reports whether a portrait is configured', async () => {
    const mediaId = await uploadImage('approve');
    await prisma.profile.update({ where: { id: profileId }, data: { portraitMediaId: null } });
    expect((await summary()).activePortraitConfigured).toBe(false);

    await prisma.profile.update({ where: { id: profileId }, data: { portraitMediaId: mediaId } });
    expect((await summary()).activePortraitConfigured).toBe(true);
  });

  it('reports whether an active CV is configured', async () => {
    const previousActive = await prisma.cvDocument.findFirst({ where: { active: true } });
    await prisma.cvDocument.updateMany({ where: { active: true }, data: { active: false } });
    expect((await summary()).activeCvConfigured).toBe(false);

    const mediaId = await uploadApprovedPdf();
    const doc = await prisma.cvDocument.create({
      data: { mediaId, title: 'Dashboard fixture CV', active: true },
    });
    expect((await summary()).activeCvConfigured).toBe(true);

    await prisma.cvDocument.delete({ where: { id: doc.id } });
    if (previousActive) {
      await prisma.cvDocument.update({ where: { id: previousActive.id }, data: { active: true } });
    }
  });
});
