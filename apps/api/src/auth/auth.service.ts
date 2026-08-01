import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
export const ACCESS_TOKEN_SECONDS = 15 * 60;
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
@Injectable()
export class AuthService {
  verifyPassword(hash: string, password: string) {
    return argon2.verify(hash, password);
  }
  newRefreshToken() {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: hashRefreshToken(token) };
  }
}
