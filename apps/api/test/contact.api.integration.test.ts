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
    expect(stored?.deliveryAttempts[0]?.status).toBe('SUCCEEDED');
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

  it('retries notification delivery, records a new attempt, and audits the retry', async () => {
    const email = `${testEmailPrefix}retry@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Retry Subject', email, message: 'Message needing a retry.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });
    const before = await prisma.contactDeliveryAttempt.count({
      where: { contactMessageId: created.id },
    });

    const response = await request(server())
      .post(`/api/v1/admin/messages/${created.id}/retry-notification`)
      .set(auth())
      .expect(200);
    expect(response.body.data.deliveryAttempts.length).toBeGreaterThan(0);

    const after = await prisma.contactDeliveryAttempt.count({
      where: { contactMessageId: created.id },
    });
    expect(after).toBe(before + 1);

    const stored = await prisma.contactMessage.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.retryClaimedAt).toBeNull(); // claim released after completion

    const actions = (
      await prisma.auditLog.findMany({
        where: { resourceId: created.id, action: 'CONTACT_MESSAGE_NOTIFICATION_RETRIED' },
      })
    ).map((row) => row.action);
    expect(actions).toEqual(['CONTACT_MESSAGE_NOTIFICATION_RETRIED']);
  });

  it('the atomic claim query lets only one of two truly concurrent claims win (Postgres row-level locking)', async () => {
    // Exercises the exact conditional UPDATE ContactService.retryNotification uses, directly and
    // concurrently — not through the full HTTP request/notifier round trip. The end-to-end 200
    // vs. 409 behavior is covered by the next two tests; the fake notifier used in this test
    // environment resolves near-instantly, which closes the real in-flight window before a
    // second HTTP request can reliably land inside it, so asserting the race through the full
    // stack would be a timing-dependent (flaky) test of the wrong thing. This is a deterministic
    // test of the actual mechanism: two genuinely concurrent claim attempts, exactly one wins.
    const email = `${testEmailPrefix}retry-atomic-claim@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Atomic Claim', email, message: 'Message for the atomic-claim test.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });

    const claim = () =>
      prisma.contactMessage.updateMany({
        where: {
          id: created.id,
          OR: [
            { retryClaimedAt: null },
            { retryClaimedAt: { lt: new Date(Date.now() - 120_000) } },
          ],
        },
        data: { retryClaimedAt: new Date() },
      });
    const [a, b] = await Promise.all([claim(), claim()]);
    expect([a.count, b.count].sort()).toEqual([0, 1]);
  });

  it('the retry endpoint returns 409 RETRY_IN_PROGRESS when a claim is already held', async () => {
    const email = `${testEmailPrefix}retry-already-claimed@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Already Claimed', email, message: 'Message for the held-claim test.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });
    await prisma.contactMessage.update({
      where: { id: created.id },
      data: { retryClaimedAt: new Date() }, // simulates another retry already in flight
    });

    const response = await request(server())
      .post(`/api/v1/admin/messages/${created.id}/retry-notification`)
      .set(auth())
      .expect(409);
    expect(response.body.error.code).toBe('RETRY_IN_PROGRESS');
  });

  it('a claim older than the reclaim TTL is treated as abandoned and can be retried', async () => {
    const email = `${testEmailPrefix}retry-stale-claim@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Stale Claim', email, message: 'Message for the stale-claim test.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });
    await prisma.contactMessage.update({
      where: { id: created.id },
      // Older than RETRY_CLAIM_TTL_MS (2 minutes) — simulates a process that crashed mid-attempt.
      data: { retryClaimedAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    await request(server())
      .post(`/api/v1/admin/messages/${created.id}/retry-notification`)
      .set(auth())
      .expect(200);
  });

  it('refuses to retry a message that has already reached the delivery-attempt cap', async () => {
    const email = `${testEmailPrefix}retry-cap@example.invalid`;
    await request(server())
      .post('/api/v1/contact')
      .send({ name: 'Retry Cap', email, message: 'Message hitting the retry cap.' })
      .expect(200);
    const created = await prisma.contactMessage.findFirstOrThrow({ where: { email } });
    // Fast-forward past the cap directly — MAX_DELIVERY_ATTEMPTS (5) in contact.service.ts — the
    // real submit-time attempt(s) plus manual retries share the same counter. attemptNumber
    // continues on from whatever submit() above already created (real ContactDeliveryAttempt
    // rows, not a fixture) — @@unique([contactMessageId, attemptNumber]) requires each fixture
    // row to have its own number, not just a matching count.
    const existingMax = await prisma.contactDeliveryAttempt.aggregate({
      where: { contactMessageId: created.id },
      _max: { attemptNumber: true },
    });
    const startAt = (existingMax._max.attemptNumber ?? 0) + 1;
    await prisma.contactDeliveryAttempt.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        contactMessageId: created.id,
        attemptNumber: startAt + i,
        status: 'FAILED',
        reason: 'fixture',
      })),
    });

    const response = await request(server())
      .post(`/api/v1/admin/messages/${created.id}/retry-notification`)
      .set(auth())
      .expect(409);
    expect(response.body.error.code).toBe('RETRY_LIMIT_REACHED');
  });

  it('rejects retry-notification without a token', async () => {
    await request(server())
      .post('/api/v1/admin/messages/nonexistent-id/retry-notification')
      .expect(401);
  });
});
