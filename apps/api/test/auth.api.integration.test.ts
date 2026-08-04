import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
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
  let throttlerStorage: ThrottlerStorageService;
  const email = 'auth-contract-admin@example.invalid';
  const password = 'Correct-Horse-Battery-9!';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = module.get(PrismaService);
    throttlerStorage = module.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  beforeEach(async () => {
    // The whole file shares one app instance (and therefore one in-memory
    // throttler), and this suite deliberately exercises the login route's
    // rate limit itself (concurrent-lockout, repeated-failure tests) — so
    // each test needs its own untouched 20-per-minute budget rather than
    // inheriting whatever earlier tests already spent.
    throttlerStorage.storage.clear();
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

  it('invalidates the access token issued to the legitimate rotation once a reuse of its retired predecessor is detected', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const firstRefreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', [`portfolio_refresh=${firstRefreshToken}`, `portfolio_csrf=${csrfToken}`])
      .expect(200);
    const rotatedAccessToken = cookieValue(
      rotated.headers['set-cookie'] as unknown as string[],
      'portfolio_access',
    )!;

    // The winning access token works right up until the retired token is
    // replayed.
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', [`portfolio_refresh=${firstRefreshToken}`, `portfolio_csrf=${csrfToken}`])
      .expect(401);

    // Reuse detection bumped tokenVersion along with revoking the family —
    // the token from the legitimate rotation is now dead too, not just the
    // replayed one.
    const rejected = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(401);
    expect(rejected.body.error.message).toMatch(/administrator session required/i);
  });

  it('handles retired-token replay idempotently: first replay revokes and bumps once, repeat replays are inert, a fresh login is unaffected', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const ancientRefreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;
    const ancientCookie = [
      `portfolio_refresh=${ancientRefreshToken}`,
      `portfolio_csrf=${csrfToken}`,
    ];
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    const versionBefore = admin.tokenVersion;

    // Retire the token via one legitimate rotation.
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', ancientCookie)
      .expect(200);
    const rotatedCookies = rotated.headers['set-cookie'] as unknown as string[];
    const currentGenAccessToken = cookieValue(rotatedCookies, 'portfolio_access')!;

    // A. First replay of the now-retired token: revokes the current
    // generation and bumps tokenVersion exactly once.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', ancientCookie)
      .expect(401);

    const afterFirstReplay = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    expect(afterFirstReplay.tokenVersion).toBe(versionBefore + 1);
    expect(
      await prisma.refreshSession.count({
        where: { userId: admin.id, tokenVersion: versionBefore, revokedAt: null },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${currentGenAccessToken}`)
      .expect(401);
    expect(
      await prisma.auditLog.count({
        where: { action: 'REFRESH_REUSE_DETECTED', actorId: admin.id },
      }),
    ).toBe(1);

    // B. Replaying the same ancient token a second time: SESSION_EXPIRED,
    // no further tokenVersion increment, no second reuse audit event.
    const secondReplay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', ancientCookie)
      .expect(401);
    expect(secondReplay.body.error.code).toBe('SESSION_EXPIRED');
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { email } })).tokenVersion).toBe(
      versionBefore + 1,
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'REFRESH_REUSE_DETECTED', actorId: admin.id },
      }),
    ).toBe(1);

    // C. The administrator logs in again (a brand-new generation).
    // Replaying the ancient token yet again must not touch it.
    const secondLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const secondLoginCookies = secondLogin.headers['set-cookie'] as unknown as string[];
    const newAccessToken = cookieValue(secondLoginCookies, 'portfolio_access')!;
    const newRefreshToken = cookieValue(secondLoginCookies, 'portfolio_refresh')!;
    const newCsrf = cookieValue(secondLoginCookies, 'portfolio_csrf')!;

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', ancientCookie)
      .expect(401);

    // The new session is completely unaffected: its access token still
    // authenticates, and its refresh token still rotates.
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', newCsrf)
      .set('Cookie', [`portfolio_refresh=${newRefreshToken}`, `portfolio_csrf=${newCsrf}`])
      .expect(200);

    // Still only bumped once, total, across this whole sequence.
    expect((await prisma.adminUser.findUniqueOrThrow({ where: { email } })).tokenVersion).toBe(
      versionBefore + 1,
    );
  });

  it('lets ten simultaneous replays of one already-retired token cause at most one version increment and one reuse audit event', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const refreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;
    const cookieHeader = [`portfolio_refresh=${refreshToken}`, `portfolio_csrf=${csrfToken}`];

    // Retire it via one legitimate rotation.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', cookieHeader)
      .expect(200);

    const adminBefore = await prisma.adminUser.findUniqueOrThrow({ where: { email } });

    const replays = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Origin', WEB_URL)
          .set('X-CSRF-Token', csrfToken)
          .set('Cookie', cookieHeader),
      ),
    );
    expect(replays.every((r) => r.status === 401)).toBe(true);

    const adminAfter = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    expect(adminAfter.tokenVersion).toBe(adminBefore.tokenVersion + 1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'REFRESH_REUSE_DETECTED', actorId: adminBefore.id },
      }),
    ).toBe(1);
    // No partial session state — the whole retired generation is revoked,
    // nothing half-updated.
    expect(
      await prisma.refreshSession.count({
        where: { userId: adminBefore.id, tokenVersion: adminBefore.tokenVersion, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('lets a refresh racing logout-all leave no usable session behind', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const loginCookies = login.headers['set-cookie'] as unknown as string[];
    const csrfToken = cookieValue(loginCookies, 'portfolio_csrf')!;
    const refreshToken = cookieValue(loginCookies, 'portfolio_refresh')!;
    const accessToken = cookieValue(loginCookies, 'portfolio_access')!;
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });

    const [refreshResult] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Origin', WEB_URL)
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', [`portfolio_refresh=${refreshToken}`, `portfolio_csrf=${csrfToken}`]),
      request(app.getHttpServer())
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`),
    ]);

    // Whether the refresh won or lost the race, its resulting access token
    // (if any) must not authenticate afterward — logout-all's tokenVersion
    // bump applies regardless of which side of the race won.
    if (refreshResult.status === 200) {
      const raceAccessToken = cookieValue(
        refreshResult.headers['set-cookie'] as unknown as string[],
        'portfolio_access',
      )!;
      const rejected = await request(app.getHttpServer())
        .get('/api/v1/auth/session')
        .set('Authorization', `Bearer ${raceAccessToken}`)
        .expect(401);
      expect(rejected.body.error.message).toMatch(/administrator session required/i);
    }

    // No active session can carry a tokenVersion older than the admin's
    // current one — that's what "no concurrent refresh may restore a
    // session after logout-all" means at the data level.
    const activeSessions = await prisma.refreshSession.findMany({
      where: { userId: admin.id, revokedAt: null },
    });
    const currentTokenVersion = (
      await prisma.adminUser.findUniqueOrThrow({
        where: { id: admin.id },
      })
    ).tokenVersion;
    expect(activeSessions.every((s) => s.tokenVersion === currentTokenVersion)).toBe(true);
  });

  it('rejects a refresh from a session row that survived with a stale tokenVersion, and cannot issue tokens from it', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', WEB_URL)
      .send({ email, password })
      .expect(200);
    const accessToken = cookieValue(
      login.headers['set-cookie'] as unknown as string[],
      'portfolio_access',
    )!;
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    const staleTokenVersion = admin.tokenVersion;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Manufacture the exact scenario a race could theoretically leave
    // behind: an unrevoked RefreshSession row whose tokenVersion predates
    // the admin's current one (e.g. a claim that committed a heartbeat
    // before logout-all's transaction, or any other edge case) — proving
    // the tokenVersion check alone (independent of revokedAt) is what
    // keeps it dead, not just timing.
    const staleRawToken = 'stale-surviving-refresh-token-for-test';
    await prisma.refreshSession.create({
      data: {
        tokenHash: hashRefreshToken(staleRawToken),
        userId: admin.id,
        tokenVersion: staleTokenVersion,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const csrf = 'test-csrf-for-stale-row';
    const rejected = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', WEB_URL)
      .set('X-CSRF-Token', csrf)
      .set('Cookie', [`portfolio_refresh=${staleRawToken}`, `portfolio_csrf=${csrf}`])
      .expect(401);
    expect(rejected.body.error.code).toBe('SESSION_EXPIRED');

    // A stale-generation session is rejected without being touched — it's
    // not treated as a new reuse event (that would mean replaying the same
    // ancient token forever keeps bumping tokenVersion and revoking
    // whatever the admin's current, unrelated generation looks like).
    const staleRow = await prisma.refreshSession.findUnique({
      where: { tokenHash: hashRefreshToken(staleRawToken) },
    });
    expect(staleRow?.revokedAt).toBeFalsy();

    const staleAudits = await prisma.auditLog.count({
      where: { action: 'STALE_REFRESH_REJECTED', actorId: admin.id },
    });
    expect(staleAudits).toBeGreaterThanOrEqual(1);
    const reuseAudits = await prisma.auditLog.count({
      where: { action: 'REFRESH_REUSE_DETECTED', actorId: admin.id },
    });
    expect(reuseAudits).toBe(0);
  });

  it('serializes concurrent failed-login attempts so the lockout threshold is never lost', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'Wrong-Password-9!' })
          .expect(401),
      ),
    );

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { email } });
    // A read-then-write counter update would lose updates under this exact
    // concurrency and could land well short of 5.
    expect(admin.failedLoginCount).toBeGreaterThanOrEqual(5);
    expect(admin.lockedUntil).toBeTruthy();

    const locked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
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
      .get('/api/v1/health/live')
      .set('Origin', 'https://evil.example')
      .expect(200);
  });

  it('rejects unauthenticated requests to admin-only endpoints', () =>
    request(app.getHttpServer()).get('/api/v1/admin/dashboard').expect(401));
});
