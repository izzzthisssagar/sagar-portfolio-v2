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

  /** Handles a genuine reuse event — a replay of a retired token whose
   * generation (tokenVersion) is still the admin's *current* one — with a
   * conditional claim, not an unconditional bump: `adminUser.updateMany`'s
   * WHERE requires tokenVersion to still equal the compromised generation,
   * so under concurrent replays of the same retired token, Postgres's row
   * lock on AdminUser serializes the attempts and only the first commits;
   * every later one re-evaluates the WHERE against the already-bumped row
   * and matches zero rows. That's what keeps ten simultaneous replays to
   * exactly one increment, one revoke sweep, and one audit event — the
   * losers change nothing and log nothing. The revoke sweep itself is
   * scoped to `tokenVersion: compromisedTokenVersion`, so it can only ever
   * touch sessions from the generation being retired, never a newer one
   * (e.g. one created by a login that happened after this reuse was
   * detected — see the stale-tokenVersion branch in `refresh`, which is
   * what makes that safe: a session from a newer generation is never
   * routed into this method at all). */
  private async revokeFamilyAsReuse(
    userId: string,
    compromisedTokenVersion: number,
    now: Date,
    ip?: string,
  ) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.adminUser.updateMany({
        where: { id: userId, tokenVersion: compromisedTokenVersion },
        data: { tokenVersion: { increment: 1 } },
      });
      if (claim.count === 0) return false;
      await tx.refreshSession.updateMany({
        where: { userId, tokenVersion: compromisedTokenVersion, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (claimed) await this.audit('REFRESH_REUSE_DETECTED', userId, ip);
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

    // A session whose tokenVersion no longer matches the admin's current
    // one belongs to a generation that's already been fully retired — by
    // an earlier reuse event (which already revoked that whole generation
    // and bumped tokenVersion) or a logout-all. It is *not* a new reuse
    // event: reacting to it the same way reuse is handled would mean
    // replaying this same ancient token forever keeps bumping tokenVersion
    // and revoking whatever the admin's *current*, unrelated generation
    // looks like — an indefinite, attacker-triggerable lockout from a
    // single old leaked token. Reject it on its own, touching nothing.
    if (session.tokenVersion !== session.user.tokenVersion) {
      await this.audit('STALE_REFRESH_REJECTED', session.userId, ip);
      throw new SessionExpiredException('Session revoked.');
    }

    // Same generation, but this exact token was already rotated — a replay
    // of a retired token within the *current* generation is a genuine new
    // reuse event.
    if (session.revokedAt) {
      await this.revokeFamilyAsReuse(session.userId, session.tokenVersion, now, ip);
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
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Touch the admin row *first*, conditioned on the generation we
      // expect — a no-op write when it matches, but as an UPDATE it takes
      // a row lock on AdminUser for the rest of this transaction. That's
      // what serializes rotation against a concurrent logout-all or reuse
      // event, both of which also touch AdminUser first (see logoutAll and
      // revokeFamilyAsReuse): without it, logout-all's session-revoke
      // sweep could take its snapshot *before* the descendant row below
      // exists, and under READ COMMITTED an UPDATE simply never sees a row
      // inserted after its snapshot was taken — even if that insert's
      // transaction commits before the sweep's transaction does. Locking
      // the same row both sides touch first forces one to fully finish
      // (sweep included) before the other can begin, so the sweep either
      // runs entirely before this descendant exists (and this rotation
      // then sees the version has moved and aborts below) or entirely
      // after (and correctly catches it).
      const stillCurrentGeneration = await tx.adminUser.updateMany({
        where: { id: session.userId, tokenVersion: session.tokenVersion },
        data: { tokenVersion: session.tokenVersion },
      });
      if (stillCurrentGeneration.count === 0) return null;
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
      await this.revokeFamilyAsReuse(session.userId, session.tokenVersion, now, ip);
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
    //
    // The AdminUser write goes *first* in this batch, not the session
    // sweep — Prisma runs a `$transaction([...])` array sequentially in
    // the given order within one transaction, and the order matters here.
    // Refresh's own rotation also touches AdminUser before it creates a
    // descendant row (see `refresh`), so whichever of the two gets there
    // first forces the other to wait for the full transaction (session
    // sweep included) to finish. Sweeping sessions first would leave a
    // window where a concurrent rotation's brand-new descendant simply
    // isn't visible yet to this sweep's snapshot — Postgres's UPDATE under
    // READ COMMITTED never picks up a row inserted by another transaction
    // after this statement's own snapshot was taken, even if that other
    // transaction commits before this one does.
    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: adminId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId: adminId, revokedAt: null },
        data: { revokedAt: new Date() },
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
