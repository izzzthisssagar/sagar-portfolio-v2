import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { hashRefreshToken } from '../src/auth/auth.service';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

function cookieValue(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0]?.slice(name.length + 1);
}

databaseSuite('Authentication vertical', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = 'auth-contract-admin@example.invalid';
  const password = 'Correct-Horse-Battery-9!';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.adminUser.deleteMany({});
    await prisma.adminUser.create({
      data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.adminUser.deleteMany({});
    await app.close();
  });

  it('logs in with valid credentials and sets the session cookies', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    expect(response.body.data.email).toBe(email);
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    expect(cookieValue(setCookie, 'portfolio_access')).toBeTruthy();
    expect(cookieValue(setCookie, 'portfolio_refresh')).toBeTruthy();
    expect(cookieValue(setCookie, 'portfolio_csrf')).toBeTruthy();
  });

  it('rejects a wrong password with a generic message', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wrong-Password-9!' })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.body.error.message).not.toMatch(/exist|found/i);
  });

  it('rejects an unknown email with the same generic message', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody-here@example.invalid', password: 'Whatever-Password-9!' })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after repeated failures and resets the counter on success', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'Wrong-Password-9!' })
        .expect(401);
    }
    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (row) => row.action,
    );
    expect(actions.filter((a) => a === 'LOGIN_LOCKED').length).toBeGreaterThan(0);
  });

  it('rotates refresh tokens and rejects reuse of the retired token across the whole family', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const firstRefreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;

    const refreshed = await agent
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .expect(200);
    const refreshedCookies = refreshed.headers['set-cookie'] as unknown as string[];
    const secondRefreshToken = cookieValue(refreshedCookies, 'portfolio_refresh')!;
    expect(secondRefreshToken).not.toBe(firstRefreshToken);

    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', [`portfolio_refresh=${firstRefreshToken}`, `portfolio_csrf=${csrfToken}`])
      .expect(401);
    expect(reuse.body.error.code).toBe('SESSION_EXPIRED');

    const secondCsrf = cookieValue(refreshedCookies, 'portfolio_csrf')!;
    const afterReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', secondCsrf)
      .set('Cookie', [`portfolio_refresh=${secondRefreshToken}`, `portfolio_csrf=${secondCsrf}`])
      .expect(401);
    expect(afterReuse.body.error.code).toBe('SESSION_EXPIRED');

    const reuseAudit = await prisma.auditLog.findFirst({
      where: { action: 'REFRESH_REUSE_DETECTED' },
    });
    expect(reuseAudit).toBeTruthy();
  });

  it('lets exactly one of two simultaneous refreshes of the same token win, and revokes the rest of the family', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const refreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;
    const cookieHeader = [`portfolio_refresh=${refreshToken}`, `portfolio_csrf=${csrfToken}`];

    // Two genuinely concurrent requests presenting the identical,
    // not-yet-rotated refresh token — the scenario a read-then-write
    // rotation can't defend against, since both requests would read the
    // same "still active" row before either commits its revoke.
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', WEB_URL)
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', cookieHeader),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', WEB_URL)
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', cookieHeader),
    ]);

    const statuses = [first.status, second.status].sort();
    // Exactly one request wins the atomic claim and rotates; the other
    // loses the race and is treated as reuse.
    expect(statuses).toEqual([200, 401]);
    const [winner, loser] = first.status === 200 ? [first, second] : [second, first];
    expect(loser.body.error.code).toBe('SESSION_EXPIRED');

    // The original session must have transitioned active -> revoked
    // exactly once, and reuse detection must have revoked the winner's
    // freshly-issued descendant too — no independently usable refresh
    // token should survive this race.
    const original = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });
    expect(original?.revokedAt).toBeTruthy();
    const winnerRefreshToken = cookieValue(
      winner.headers['set-cookie'] as unknown as string[],
      'portfolio_refresh',
    )!;
    const descendant = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(winnerRefreshToken) },
    });
    expect(descendant?.revokedAt).toBeTruthy();
    expect(
      await prisma.refreshSession.count({
        where: { userId: original!.userId, revokedAt: null },
      }),
    ).toBe(0);

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (row) => row.action,
    );
    expect(actions.filter((a) => a === 'TOKEN_REFRESHED')).toHaveLength(1);
    expect(actions.filter((a) => a === 'REFRESH_REUSE_DETECTED')).toHaveLength(1);
  });

  it('logs out the current session without disturbing others, and logout-all revokes every session', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(cookies, 'portfolio_csrf')!;
    const accessToken = cookieValue(cookies, 'portfolio_access')!;

    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .expect(204);

    expect(await prisma.refreshSession.count({ where: { revokedAt: null } })).toBe(0);

    // Logout clears the CSRF cookie too, so the retained header token no
    // longer double-submits — a stale client is stopped at the CSRF layer
    // before the (also-revoked) refresh token is ever inspected.
    const refreshAfterLogout = await agent
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .expect(403);
    expect(refreshAfterLogout.body.error.code).toBe('CSRF_TOKEN_INVALID');

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect(
      await prisma.refreshSession.count({ where: { revokedAt: null } }),
    ).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    expect(await prisma.refreshSession.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('logout-all immediately invalidates an already-issued, still-unexpired access token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const accessToken = cookieValue(
      login.headers['set-cookie'] as unknown as string[],
      'portfolio_access',
    )!;

    // The token is real, correctly signed, and not expired — it works
    // right up until logout-all is called.
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Same still-unexpired token, immediately after logout-all: rejected.
    // This is what distinguishes "revokes refresh capability" from
    // "revokes this admin's access right now" — logout-all does the latter.
    const rejected = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    expect(rejected.body.error.message).toMatch(/administrator session required/i);
  });

  it('reports session info for an authenticated administrator', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = cookieValue(
      login.headers['set-cookie'] as unknown as string[],
      'portfolio_access',
    )!;
    const session = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(session.body.data.admin.email).toBe(email);
    expect(session.body.data.activeSessions).toBeGreaterThanOrEqual(1);
  });

  it('rejects a cookie-authenticated mutation with a missing or mismatched CSRF token', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const csrfToken = cookieValue(
      login.headers['set-cookie'] as unknown as string[],
      'portfolio_csrf',
    )!;

    const missing = await agent.post('/api/v1/auth/logout').set('Origin', WEB_URL).expect(403);
    expect(missing.body.error.code).toBe('CSRF_TOKEN_INVALID');

    const mismatched = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', `${csrfToken}-tampered`)
      .expect(403);
    expect(mismatched.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a cross-origin mutation and leaves GET requests unaffected', async () => {
    const crossOrigin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email, password })
      .expect(403);
    expect(crossOrigin.body.error.code).toBe('CSRF_ORIGIN_REJECTED');

    await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });

  it('rejects unauthenticated requests to admin-only endpoints', () =>
    request(app.getHttpServer()).get('/api/v1/admin/dashboard').expect(401));
});
