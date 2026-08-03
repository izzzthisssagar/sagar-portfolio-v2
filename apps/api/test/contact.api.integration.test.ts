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

databaseSuite('Contact messages: submission, honeypot, delivery tracking, admin inbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const testEmailPrefix = 'contact-contract-';
  const adminEmail = 'contact-contract-admin@example.invalid';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    await prisma.contactMessage.deleteMany({ where: { email: { startsWith: testEmailPrefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    const admin = await prisma.adminUser.create({
      data: {
        email: adminEmail,
        passwordHash: await argon2.hash('Contact-Contract-9!', { type: argon2.argon2id }),
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
    await prisma.contactMessage.deleteMany({ where: { email: { startsWith: testEmailPrefix } } });
    await prisma.adminUser.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const server = () => app.getHttpServer();

  it('rejects admin message routes without a token', async () => {
    await request(server()).get('/api/v1/admin/messages').expect(401);
  });

  it('persists a genuine submission, returns a generic response, and records a delivery attempt', async () => {
    const email = `${testEmailPrefix}real@example.invalid`;
    const response = await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Real Visitor', email, message: 'A real question about your work.' })
      .expect(200);
    expect(response.body).toEqual({ data: { received: true } });

    const stored = await prisma.contactMessage.findFirst({
      where: { email },
      include: { deliveryAttempts: true },
    });
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('NEW');
    expect(stored?.deliveryAttempts).toHaveLength(1);
    expect(stored?.deliveryAttempts[0]?.success).toBe(true);
  });

  it('accepts a honeypot-tripped submission with the same generic response but never persists it', async () => {
    const email = `${testEmailPrefix}bot@example.invalid`;
    const response = await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Bot', email, message: 'spam', website: 'http://spam.example' })
      .expect(200);
    expect(response.body).toEqual({ data: { received: true } });
    const stored = await prisma.contactMessage.findFirst({ where: { email } });
    expect(stored).toBeNull();
  });

  it('collapses an identical resubmission within the duplicate window into a single row', async () => {
    const email = `${testEmailPrefix}dup@example.invalid`;
    const body = { name: 'Dup Visitor', email, message: 'Same message twice.' };
    await request(server()).post('/api/v1/contact').send(body).expect(200);
    await request(server()).post('/api/v1/contact').send(body).expect(200);
    const stored = await prisma.contactMessage.findMany({ where: { email } });
    expect(stored).toHaveLength(1);
  });

  it('rejects an invalid submission (missing message)', async () => {
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'No Message', email: `${testEmailPrefix}invalid@example.invalid` })
      .expect(400);
  });

  it('lists, filters by status, updates status, and deletes with audit events', async () => {
    const email = `${testEmailPrefix}admin-flow@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Admin Flow', email, message: 'Message for admin flow test.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });

    const list = await request(server()).get('/api/v1/admin/messages').set(auth()).expect(200);
    expect(list.body.data.some((m: { id: string }) => m.id === created.id)).toBe(true);

    const filtered = await request(server())
      .get('/api/v1/admin/messages?status=new')
      .set(auth())
      .expect(200);
    expect(filtered.body.data.every((m: { status: string }) => m.status === 'new')).toBe(true);

    await request(server())
      .patch(`/api/v1/admin/messages/${created.id}/status`)
      .set(auth())
      .send({ status: 'read' })
      .expect(200);

    await request(server()).delete(`/api/v1/admin/messages/${created.id}`).set(auth()).expect(200);

    const actions = (
      await prisma.auditLog.findMany({
        where: { resourceId: created.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.action);
    expect(actions).toEqual(['CONTACT_MESSAGE_STATUS_CHANGED', 'CONTACT_MESSAGE_DELETED']);
  });
});
