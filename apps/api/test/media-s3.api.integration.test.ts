import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The full-stack counterpart to s3-storage.adapter.integration.test.ts: proves the API's public
 * media route actually serves from — and immediately stops serving from — a real S3-compatible
 * bucket (MinIO), not just that the adapter class works in isolation. Everything driver-agnostic
 * (upload validation, quarantine, the local-storage happy path) is already covered by
 * media.api.integration.test.ts; this file only re-verifies the two behaviors that are genuinely
 * driver-sensitive: public delivery through the real bucket, and archived-media unavailability.
 *
 * Gated on both DATABASE_URL and MEDIA_STORAGE_ENDPOINT — required in CI, skipped locally when
 * MinIO isn't running (see .github/workflows/ci.yml).
 */
const canRun = Boolean(process.env.DATABASE_URL) && Boolean(process.env.MEDIA_STORAGE_ENDPOINT);
const s3Suite = canRun ? describe : describe.skip;
const accessSecret = process.env.ACCESS_TOKEN_SECRET ?? '';
const accessIssuer = process.env.ACCESS_TOKEN_ISSUER ?? '';
const accessAudience = process.env.ACCESS_TOKEN_AUDIENCE ?? '';

async function pngBuffer(color: string): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: color } })
    .png()
    .toBuffer();
}

s3Suite('Media pipeline over the real S3-compatible protocol (MinIO)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let adminId: string;
  let rawClient: S3Client;
  const bucket = process.env.MEDIA_STORAGE_BUCKET ?? '';
  const adminEmail = 'media-s3-contract-admin@example.invalid';
  const createdKeys: string[] = [];
  // Restored in afterAll — other test files (e.g. posts.api.integration.test.ts) run in the same
  // process (vitest.config.ts disables file parallelism) and must not inherit this override.
  const originalDriver = process.env.MEDIA_STORAGE_DRIVER;

  beforeAll(async () => {
    process.env.MEDIA_STORAGE_DRIVER = 's3';

    rawClient = new S3Client({
      region: process.env.MEDIA_STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.MEDIA_STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.MEDIA_STORAGE_SECRET_KEY ?? '',
      },
      endpoint: process.env.MEDIA_STORAGE_ENDPOINT ?? '',
      forcePathStyle: true,
    });

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Media-S3-Contract-9!', { type: argon2.argon2id }),
      },
    });
    adminId = admin.id;
    adminToken = new JwtService().sign(
      { sub: admin.id, role: 'admin', tokenVersion: admin.tokenVersion },
      { secret: accessSecret, issuer: accessIssuer, audience: accessAudience, algorithm: 'HS256', expiresIn: '5m' },
    );
  });

  afterAll(async () => {
    await prisma.mediaAsset.deleteMany({ where: { createdById: adminId } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
    await Promise.all(
      createdKeys.map((key) =>
        rawClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {}),
      ),
    );
    if (originalDriver === undefined) delete process.env.MEDIA_STORAGE_DRIVER;
    else process.env.MEDIA_STORAGE_DRIVER = originalDriver;
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  it('uploads to a real quarantine/ object in the bucket', async () => {
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#ff00ff'), { filename: 's3-evidence.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body.data.storageKey).toMatch(/^quarantine\//);
    createdKeys.push(uploaded.body.data.storageKey);

    // Ground truth: the object genuinely exists in MinIO, independent of what the API claims.
    await expect(
      rawClient.send(new HeadObjectCommand({ Bucket: bucket, Key: uploaded.body.data.storageKey })),
    ).resolves.toBeDefined();
  });

  it('approve moves the real bucket object from quarantine/ to approved/, then serves it publicly from MinIO', async () => {
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#00ff88'), { filename: 's3-public.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;
    const quarantineKey = uploaded.body.data.storageKey as string;

    const approved = await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'S3 public-delivery evidence.' })
      .expect(201);
    const approvedKey = approved.body.data.storageKey as string;
    expect(approvedKey).toMatch(/^approved\//);
    createdKeys.push(approvedKey);

    // The old quarantine object is genuinely gone from the bucket, not just relabeled in the DB.
    await expect(
      rawClient.send(new HeadObjectCommand({ Bucket: bucket, Key: quarantineKey })),
    ).rejects.toThrow();

    // The public route actually streams bytes that came from MinIO.
    const publicResponse = await request(server()).get(`/api/v1/media/${id}/file`).expect(200);
    expect(publicResponse.headers['content-type']).toContain('image/png');
  });

  it('archiving revokes public delivery immediately — the bucket object moves to archived/, and the old approved/ key is gone', async () => {
    const uploaded = await request(server())
      .post('/api/v1/admin/media')
      .set(auth())
      .attach('file', await pngBuffer('#8800ff'), { filename: 's3-archive.png', contentType: 'image/png' })
      .expect(201);
    const id = uploaded.body.data.id as string;

    const approved = await request(server())
      .post(`/api/v1/admin/media/${id}/approve`)
      .set(auth())
      .send({ altText: 'S3 archive-revocation evidence.' })
      .expect(201);
    const approvedKey = approved.body.data.storageKey as string;

    await request(server()).get(`/api/v1/media/${id}/file`).expect(200);

    const archived = await request(server())
      .post(`/api/v1/admin/media/${id}/archive`)
      .set(auth())
      .expect(201);
    const archivedKey = archived.body.data.storageKey as string;
    expect(archivedKey).toMatch(/^archived\//);
    createdKeys.push(archivedKey);

    await request(server()).get(`/api/v1/media/${id}/file`).expect(404);
    await expect(
      rawClient.send(new HeadObjectCommand({ Bucket: bucket, Key: approvedKey })),
    ).rejects.toThrow();
    await expect(
      rawClient.send(new HeadObjectCommand({ Bucket: bucket, Key: archivedKey })),
    ).resolves.toBeDefined();
  });
});
