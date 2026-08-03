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

databaseSuite('Portrait and CV management', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let profileId: string;
  let originalPortraitMediaId: string | null;
  const adminEmail = 'portrait-cv-contract-admin@example.invalid';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Portrait-Cv-Contract-9!', { type: argon2.argon2id }),
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
          name: 'Portrait/CV Test Fixture',
          headline: 'Test fixture headline',
          bio: 'Created by portrait-cv.api.integration.test.ts — no Profile row existed yet.',
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
    await prisma.cvDocument.deleteMany({ where: { media: { createdById: adminId } } });
    await prisma.mediaAsset.deleteMany({ where: { createdById: adminId } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  let imageSeed = 0;
  // Each call must produce distinct bytes — the upload pipeline dedupes by SHA-256, so identical
  // bytes across calls would return the same already-approved row and a second `/approve` call
  // on it would 400 ("only quarantined media can be approved").
  async function uploadApprovedImage() {
    imageSeed += 1;
    const buffer = await sharp({
      create: { width: 4 + imageSeed, height: 4, channels: 3, background: '#ff5a35' },
    })
      .png()
      .toBuffer();
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', buffer, { filename: 'portrait.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'A test portrait.' })
      .expect(201);
    return id;
  }

  let pdfSeed = 0;
  async function uploadApprovedPdf(filename: string) {
    pdfSeed += 1;
    const pdf = Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Seed ${pdfSeed}>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
      'latin1',
    );
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', pdf, { filename, contentType: 'application/pdf' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ decorative: true })
      .expect(201);
    return id;
  }

  describe('portrait', () => {
    it('rejects a quarantined image as the portrait', async () => {
      const buffer = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#000' },
      })
        .png()
        .toBuffer();
      const uploaded = await request(server())
        .post('/api/v1/admin/media')
        .set(auth())
        .attach('file', buffer, { filename: 'unapproved.png', contentType: 'image/png' })
        .expect(201);
      await request(server())
        .post('/api/v1/admin/profile/portrait')
        .set(auth())
        .send({ mediaId: uploaded.body.data.id })
        .expect(400);
    });

    it('rejects a PDF as the portrait', async () => {
      const pdfId = await uploadApprovedPdf('not-a-portrait.pdf');
      await request(server())
        .post('/api/v1/admin/profile/portrait')
        .set(auth())
        .send({ mediaId: pdfId })
        .expect(400);
    });

    it('activates an approved image portrait, exposes it publicly, and clears it', async () => {
      await request(server())
        .get('/api/v1/profile/portrait')
        .expect(200)
        .then((res) => {
          expect(res.body.data).toBeNull();
        });

      const mediaId = await uploadApprovedImage();
      const set = await request(server())
        .post('/api/v1/admin/profile/portrait')
        .set(auth())
        .send({ mediaId })
        .expect(201);
      expect(set.body.data.portraitMediaId).toBe(mediaId);

      const publicPortrait = await request(server()).get('/api/v1/profile/portrait').expect(200);
      expect(publicPortrait.body.data.mediaId).toBe(mediaId);

      const file = await request(server()).get(`/api/v1/media/${mediaId}/file`).expect(200);
      expect(file.headers['content-type']).toBe('image/png');

      await request(server()).delete('/api/v1/admin/profile/portrait').set(auth()).expect(200);
      const cleared = await request(server()).get('/api/v1/profile/portrait').expect(200);
      expect(cleared.body.data).toBeNull();
    });

    it('exposes the public profile subset for SEO metadata, without email', async () => {
      const res = await request(server()).get('/api/v1/profile').expect(200);
      expect(res.body.data).toMatchObject({
        name: expect.any(String),
        headline: expect.any(String),
        bio: expect.any(String),
      });
      expect(res.body.data.email).toBeUndefined();
    });

    it('blocks deleting the media asset while it is the active portrait', async () => {
      const mediaId = await uploadApprovedImage();
      await request(server())
        .post('/api/v1/admin/profile/portrait')
        .set(auth())
        .send({ mediaId })
        .expect(201);
      await request(server()).delete(`/api/v1/admin/media/${mediaId}`).set(auth()).expect(409);
      await request(server()).delete('/api/v1/admin/profile/portrait').set(auth()).expect(200);
    });
  });

  describe('CV', () => {
    it('rejects an image as a CV document', async () => {
      const imageId = await uploadApprovedImage();
      await request(server())
        .post('/api/v1/admin/cv')
        .set(auth())
        .send({ mediaId: imageId, title: 'Not a PDF' })
        .expect(400);
    });

    it('returns 404 from the public download route when no CV is active', async () => {
      await request(server()).get('/api/v1/documents/cv').expect(404);
    });

    it('creates, activates, and serves the active CV publicly with a safe filename', async () => {
      const pdfId = await uploadApprovedPdf('cv-v1.pdf');
      const created = await request(server())
        .post('/api/v1/admin/cv')
        .set(auth())
        .send({ mediaId: pdfId, title: 'CV v1', versionNote: 'Initial version.' })
        .expect(201);
      const docId = created.body.data.id as string;
      await request(server()).post(`/api/v1/admin/cv/${docId}/activate`).set(auth()).expect(201);

      const download = await request(server()).get('/api/v1/documents/cv').expect(200);
      expect(download.headers['content-type']).toBe('application/pdf');
      expect(download.headers['content-disposition']).toContain('Sagar-Thapa-CV.pdf');
      expect(download.headers['content-disposition']).not.toContain(pdfId);
    });

    it('activating a new CV deactivates the previous one, and the active one cannot be deleted', async () => {
      const pdfA = await uploadApprovedPdf('cv-a.pdf');
      const pdfB = await uploadApprovedPdf('cv-b.pdf');
      const a = await request(server())
        .post('/api/v1/admin/cv')
        .set(auth())
        .send({ mediaId: pdfA, title: 'CV A' })
        .expect(201);
      const b = await request(server())
        .post('/api/v1/admin/cv')
        .set(auth())
        .send({ mediaId: pdfB, title: 'CV B' })
        .expect(201);

      await request(server())
        .post(`/api/v1/admin/cv/${a.body.data.id}/activate`)
        .set(auth())
        .expect(201);
      await request(server())
        .post(`/api/v1/admin/cv/${b.body.data.id}/activate`)
        .set(auth())
        .expect(201);

      const list = await request(server()).get('/api/v1/admin/cv').set(auth()).expect(200);
      const activeIds = list.body.data
        .filter((d: { active: boolean }) => d.active)
        .map((d: { id: string }) => d.id);
      expect(activeIds).toEqual([b.body.data.id]);

      await request(server()).delete(`/api/v1/admin/cv/${b.body.data.id}`).set(auth()).expect(409);
      await request(server()).delete(`/api/v1/admin/cv/${a.body.data.id}`).set(auth()).expect(200);
    });
  });
});
