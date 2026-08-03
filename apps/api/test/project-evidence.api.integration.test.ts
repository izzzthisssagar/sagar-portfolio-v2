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

databaseSuite(
  'Project evidence: approved-only attachment, public confirmed-only visibility',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let adminToken: string;
    let adminId: string;
    const prefix = 'evidence-contract-';
    const adminEmail = 'evidence-contract-admin@example.invalid';

    beforeAll(async () => {
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestApplication();
      configureApp(app);
      await app.init();
      prisma = module.get(PrismaService);
      await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
      await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
      const admin = await prisma.adminUser.create({
        data: {
          email: adminEmail,
          passwordHash: await argon2.hash('Evidence-Contract-9!', { type: argon2.argon2id }),
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
      await prisma.project.deleteMany({ where: { slug: { startsWith: prefix } } });
      await prisma.mediaAsset.deleteMany({ where: { createdById: adminId } });
      await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
      await app.close();
    });

    const auth = () => ({ Authorization: `Bearer ${adminToken}` });
    const server = () => app.getHttpServer();

    async function uploadAndApprove(color: string) {
      const buffer = await sharp({
        create: { width: 4, height: 4, channels: 3, background: color },
      })
        .png()
        .toBuffer();
      const uploaded = await request(server())
        .post('/api/v1/admin/media')
        .set(auth())
        .attach('file', buffer, { filename: 'evidence.png', contentType: 'image/png' })
        .expect(201);
      const id = uploaded.body.data.id as string;
      await request(server())
        .post(`/api/v1/admin/media/${id}/approve`)
        .set(auth())
        .send({ altText: 'Evidence screenshot.' })
        .expect(201);
      return id;
    }

    async function createPublishableProject(slug: string) {
      const created = await request(server())
        .post('/api/v1/admin/projects')
        .set(auth())
        .send({
          title: 'Evidence Contract Project',
          slug,
          summary: 'A project used to test evidence attachment and public visibility.',
          overview: 'Overview text.',
          responsibilities: 'Responsibilities text.',
          order: 1,
        })
        .expect(201);
      return created.body.data.id as string;
    }

    it('rejects attaching a media asset that is not approved', async () => {
      const projectId = await createPublishableProject(`${prefix}unapproved`);
      const uploaded = await request(server())
        .post('/api/v1/admin/media')
        .set(auth())
        .attach(
          'file',
          await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } })
            .png()
            .toBuffer(),
          {
            filename: 'quarantined.png',
            contentType: 'image/png',
          },
        )
        .expect(201);
      await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({ mediaId: uploaded.body.data.id, evidenceStatus: 'pending', order: 0 })
        .expect(400);
    });

    it('attaches approved media, and only CONFIRMED evidence is visible on the published project publicly', async () => {
      const projectId = await createPublishableProject(`${prefix}visibility`);
      const confirmedMediaId = await uploadAndApprove('#00ff00');
      const pendingMediaId = await uploadAndApprove('#0000ff');

      const confirmed = await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({
          mediaId: confirmedMediaId,
          evidenceStatus: 'confirmed',
          order: 0,
          title: 'Confirmed shot',
        })
        .expect(201);
      expect(confirmed.body.data.evidenceStatus).toBe('confirmed');

      await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({
          mediaId: pendingMediaId,
          evidenceStatus: 'pending',
          order: 1,
          title: 'Pending shot',
        })
        .expect(201);

      const admin = await request(server())
        .get(`/api/v1/admin/projects/${projectId}`)
        .set(auth())
        .expect(200);
      expect(admin.body.data.evidence).toHaveLength(2);

      const slug = `${prefix}visibility`;
      await request(server())
        .post(`/api/v1/admin/projects/${projectId}/workflow`)
        .set(auth())
        .send({ transition: 'publish' })
        .expect(201);

      const publicView = await request(server()).get(`/api/v1/projects/${slug}`).expect(200);
      expect(publicView.body.data.evidence).toHaveLength(1);
      expect(publicView.body.data.evidence[0].evidenceStatus).toBe('confirmed');
      expect(publicView.body.data.evidence[0].title).toBe('Confirmed shot');
    });

    it('reorders evidence and rejects an invalid ordering payload', async () => {
      const projectId = await createPublishableProject(`${prefix}reorder`);
      const mediaA = await uploadAndApprove('#111111');
      const mediaB = await uploadAndApprove('#222222');
      const a = await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({ mediaId: mediaA, evidenceStatus: 'confirmed', order: 0 })
        .expect(201);
      const b = await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({ mediaId: mediaB, evidenceStatus: 'confirmed', order: 1 })
        .expect(201);

      await request(server())
        .patch(`/api/v1/admin/projects/${projectId}/evidence/reorder`)
        .set(auth())
        .send({ orderedIds: [a.body.data.id] })
        .expect(400);

      await request(server())
        .patch(`/api/v1/admin/projects/${projectId}/evidence/reorder`)
        .set(auth())
        .send({ orderedIds: [b.body.data.id, a.body.data.id] })
        .expect(200);

      const list = await request(server())
        .get(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .expect(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).toEqual([
        b.body.data.id,
        a.body.data.id,
      ]);
    });

    it('audits create, update, and delete', async () => {
      const projectId = await createPublishableProject(`${prefix}audit`);
      const mediaId = await uploadAndApprove('#333333');
      const created = await request(server())
        .post(`/api/v1/admin/projects/${projectId}/evidence`)
        .set(auth())
        .send({ mediaId, evidenceStatus: 'confirmed', order: 0 })
        .expect(201);
      const evidenceId = created.body.data.id as string;
      await request(server())
        .patch(`/api/v1/admin/projects/${projectId}/evidence/${evidenceId}`)
        .set(auth())
        .send({ caption: 'Updated caption' })
        .expect(200);
      await request(server())
        .delete(`/api/v1/admin/projects/${projectId}/evidence/${evidenceId}`)
        .set(auth())
        .expect(200);
      const actions = (
        await prisma.auditLog.findMany({
          where: { resourceId: evidenceId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.action);
      expect(actions).toEqual(['EVIDENCE_CREATED', 'EVIDENCE_UPDATED', 'EVIDENCE_DELETED']);
    });
  },
);
