import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccountLockedException,
  AuthNotProvisionedException,
  InvalidCredentialsException,
  SessionExpiredException,
} from './auth.exceptions';
import { normalizeEmail } from './email';
import { loadAccessTokenConfig } from './jwt-config';
import { ACCESS_TOKEN_SECONDS, REFRESH_TOKEN_SECONDS } from './token-lifetimes';

export { ACCESS_TOKEN_SECONDS };
export const MAX_LOGIN_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface LoginSecurityState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}
export function nextLoginFailure(state: LoginSecurityState, now: Date): LoginSecurityState {
  const count = state.failedLoginCount + 1;
  return {
    failedLoginCount: count,
    lockedUntil:
      count >= MAX_LOGIN_FAILURES ? new Date(now.getTime() + LOCKOUT_MS) : state.lockedUntil,
  };
}
export function canAttemptLogin(state: LoginSecurityState, now: Date) {
  return !state.lockedUntil || state.lockedUntil <= now;
}
export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function hashIp(ip: string) {
  return createHash('sha256').update(ip).digest('hex');
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  admin: { id: string; email: string };
}

let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash('timing-parity-constant-not-a-real-secret');
  return dummyHashPromise;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }

  newRefreshToken() {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: hashRefreshToken(token) };
  }

  private signAccessToken(adminId: string, tokenVersion: number): string {
    const config = loadAccessTokenConfig();
    if (!config) throw new AuthNotProvisionedException();
    return this.jwt.sign(
      { sub: adminId, role: 'admin', tokenVersion },
      {
        secret: config.secret,
        issuer: config.issuer,
        audience: config.audience,
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_SECONDS,
      },
    );
  }

  private async audit(
    action: string,
    actorId?: string,
    ip?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      action,
      ...(actorId ? { actorId } : {}),
      ...(ip ? { ipHash: hashIp(ip) } : {}),
      ...(metadata ? { metadata } : {}),
    };
    await this.prisma.auditLog.create({ data });
  }

  async login(email: string, password: string, ip?: string): Promise<SessionTokens> {
    if (!loadAccessTokenConfig()) throw new AuthNotProvisionedException();
    const normalized = normalizeEmail(email);
    const admin = await this.prisma.adminUser.findUnique({ where: { email: normalized } });
    const now = new Date();

    if (!admin) {
      await this.verifyPassword(await dummyHash(), password).catch(() => false);
      await this.audit('LOGIN_FAILURE', undefined, ip, { reason: 'unknown_account' });
      throw new InvalidCredentialsException();
    }

    if (
      !canAttemptLogin(
        { failedLoginCount: admin.failedLoginCount, lockedUntil: admin.lockedUntil },
        now,
      )
    ) {
      await this.audit('LOGIN_LOCKED', admin.id, ip);
      throw new AccountLockedException(admin.lockedUntil!);
    }

    const passwordOk = await this.verifyPassword(admin.passwordHash, password);
    if (!passwordOk) {
      // Atomic DB-side increment, not a read-then-write of `admin.failedLoginCount`
      // (a value already stale by the time argon2.verify above returns) — under
      // concurrent wrong-password attempts, computing the next count in
      // application code from that stale read loses updates: five concurrent
      // requests all reading the same starting count would each write back the
      // same "+1" value instead of the counter actually reaching five. Postgres
      // serializes concurrent `UPDATE ... SET x = x + 1` statements on the same
      // row, so this always reflects every attempt exactly once.
      const { failedLoginCount } = await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      let lockedUntil: Date | null = null;
      if (failedLoginCount >= MAX_LOGIN_FAILURES) {
        lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
        await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lockedUntil } });
      }
      await this.audit(lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILURE', admin.id, ip);
      throw new InvalidCredentialsException();
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    const { token: refreshToken, hash } = this.newRefreshToken();
    await this.prisma.refreshSession.create({
      data: {
        tokenHash: hash,
        userId: admin.id,
        tokenVersion: admin.tokenVersion,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SECONDS * 1000),
      },
    });
    await this.audit('LOGIN_SUCCESS', admin.id, ip);
    return {
      accessToken: this.signAccessToken(admin.id, admin.tokenVersion),
      refreshToken,
      admin: { id: admin.id, email: admin.email },
    };
  }

  /** Revokes the whole session family and bumps tokenVersion in one
   * transaction — both a genuine reuse (replay of an already-retired
   * token) and a stale tokenVersion (the session predates a logout-all or
   * an earlier reuse event) are treated identically: assume the family is
   * compromised or simply superseded, kill every session, and invalidate
   * any access token already issued under the old version. Bundling the
   * revoke and the bump together is what makes "no concurrent refresh may
   * restore a session after logout-all" hold — a concurrent refresh either
   * sees this transaction's committed effects (revokedAt set, so its own
   * claim fails) or commits first itself, in which case *its* descendant
   * still carries the pre-bump tokenVersion and is therefore rejected by
   * every later check (JwtAuthGuard for the access token, this same
   * tokenVersion comparison for any attempt to refresh it again). */
  private async revokeFamilyAsReuse(userId: string, now: Date, ip?: string) {
    await this.prisma.$transaction([
      this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.adminUser.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
    await this.audit('REFRESH_REUSE_DETECTED', userId, ip);
  }

  async refresh(rawToken: string | undefined, ip?: string): Promise<SessionTokens> {
    if (!loadAccessTokenConfig()) throw new AuthNotProvisionedException();
    if (!rawToken) throw new SessionExpiredException();
    const hash = hashRefreshToken(rawToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!session) throw new SessionExpiredException();
    const now = new Date();

    // Reused (already-retired) token, or a session whose tokenVersion no
    // longer matches the admin's current one (logout-all or an earlier
    // reuse event happened after this session was created/rotated) — both
    // are handled the same way.
    if (session.revokedAt || session.tokenVersion !== session.user.tokenVersion) {
      await this.revokeFamilyAsReuse(session.userId, now, ip);
      throw new SessionExpiredException('Session revoked.');
    }
    if (session.expiresAt <= now) throw new SessionExpiredException();

    const { token: refreshToken, hash: newHash } = this.newRefreshToken();
    // Atomic claim: the read above (`findUnique`) is not what makes rotation
    // safe under concurrency — two requests presenting the same refresh
    // token can both pass it. What makes rotation safe is this UPDATE.
    // Under Postgres's default READ COMMITTED isolation, a second
    // transaction's `UPDATE ... WHERE revokedAt IS NULL` targeting the same
    // row blocks on the first transaction's row lock, then re-evaluates the
    // WHERE clause against the just-committed row once the lock is
    // released — so at most one of any number of concurrent callers can
    // ever match and claim the session; every other caller sees `count: 0`.
    // The same lock is what serializes this against a concurrent
    // logout-all's session-revoke update — whichever commits first wins.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (claim.count === 0) return null;
      const next = await tx.refreshSession.create({
        data: {
          tokenHash: newHash,
          userId: session.userId,
          tokenVersion: session.tokenVersion,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SECONDS * 1000),
        },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: next.id },
      });
      return next;
    });

    if (!rotated) {
      // Lost the atomic claim: another request rotated this exact,
      // not-yet-revoked session between our read and our claim attempt.
      // Two independently usable holders of the same refresh token is
      // exactly what reuse detection defends against, so this is handled
      // identically to presenting an already-retired token — the whole
      // session family (including whichever descendant just won the race)
      // is revoked and the attempt is audited as a reuse event.
      await this.revokeFamilyAsReuse(session.userId, now, ip);
      throw new SessionExpiredException('Session revoked.');
    }

    await this.audit('TOKEN_REFRESHED', session.userId, ip);
    return {
      accessToken: this.signAccessToken(session.userId, session.tokenVersion),
      refreshToken,
      admin: { id: session.user.id, email: session.user.email },
    };
  }

  async logout(rawToken: string | undefined, actorId?: string, ip?: string) {
    if (rawToken) {
      const hash = hashRefreshToken(rawToken);
      await this.prisma.refreshSession.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit('LOGOUT', actorId, ip);
  }

  async logoutAll(adminId: string, ip?: string) {
    // Both writes must land in one transaction: bumping tokenVersion
    // invalidates every access token already issued to this admin
    // immediately (JwtAuthGuard rejects any token signed with an older
    // version), and revoking every active refresh session closes the
    // family. If these were two separate writes, a refresh racing between
    // them could read the session as still-active under the old
    // tokenVersion and rotate it — a session "restored" after logout-all.
    // With the writes atomic, a concurrent refresh either sees both
    // committed (its claim on the now-revoked row fails) or commits first
    // itself, in which case its descendant still carries the pre-bump
    // tokenVersion and is rejected by every later check.
    await this.prisma.$transaction([
      this.prisma.refreshSession.updateMany({
        where: { userId: adminId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.adminUser.update({
        where: { id: adminId },
        data: { tokenVersion: { increment: 1 } },
      }),
    ]);
    await this.audit('LOGOUT_ALL', adminId, ip);
  }

  async getSession(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true },
    });
    if (!admin) throw new SessionExpiredException();
    const activeSessions = await this.prisma.refreshSession.count({
      where: { userId: adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return { admin, activeSessions };
  }
}
