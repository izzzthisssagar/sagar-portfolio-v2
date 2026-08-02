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

  private signAccessToken(adminId: string): string {
    const config = loadAccessTokenConfig();
    if (!config) throw new AuthNotProvisionedException();
    return this.jwt.sign(
      { sub: adminId, role: 'admin' },
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

    if (!canAttemptLogin({ failedLoginCount: admin.failedLoginCount, lockedUntil: admin.lockedUntil }, now)) {
      await this.audit('LOGIN_LOCKED', admin.id, ip);
      throw new AccountLockedException(admin.lockedUntil!);
    }

    const passwordOk = await this.verifyPassword(admin.passwordHash, password);
    if (!passwordOk) {
      const next = nextLoginFailure(
        { failedLoginCount: admin.failedLoginCount, lockedUntil: admin.lockedUntil },
        now,
      );
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { failedLoginCount: next.failedLoginCount, lockedUntil: next.lockedUntil },
      });
      await this.audit(next.lockedUntil ? 'LOGIN_LOCKED' : 'LOGIN_FAILURE', admin.id, ip);
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
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SECONDS * 1000),
      },
    });
    await this.audit('LOGIN_SUCCESS', admin.id, ip);
    return {
      accessToken: this.signAccessToken(admin.id),
      refreshToken,
      admin: { id: admin.id, email: admin.email },
    };
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

    if (session.revokedAt) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit('REFRESH_REUSE_DETECTED', session.userId, ip);
      throw new SessionExpiredException('Session revoked.');
    }
    if (session.expiresAt <= now) throw new SessionExpiredException();

    const { token: refreshToken, hash: newHash } = this.newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      const next = await tx.refreshSession.create({
        data: {
          tokenHash: newHash,
          userId: session.userId,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_SECONDS * 1000),
        },
      });
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: now, replacedById: next.id },
      });
    });
    await this.audit('TOKEN_REFRESHED', session.userId, ip);
    return {
      accessToken: this.signAccessToken(session.userId),
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
    await this.prisma.refreshSession.updateMany({
      where: { userId: adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
