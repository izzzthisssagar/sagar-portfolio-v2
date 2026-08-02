import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_SECONDS,
  AuthService,
  canAttemptLogin,
  hashRefreshToken,
  nextLoginFailure,
} from './auth.service';
describe('auth security contracts', () => {
  it('uses a short access-token window', () =>
    expect(ACCESS_TOKEN_SECONDS).toBeLessThanOrEqual(900));
  it('locks after repeated failures and later allows retry', () => {
    const now = new Date('2026-08-02T00:00:00Z');
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < 5; i++) state = nextLoginFailure(state, now);
    expect(canAttemptLogin(state, now)).toBe(false);
    expect(canAttemptLogin(state, new Date(now.getTime() + 16 * 60 * 1000))).toBe(true);
  });
  it('stores refresh tokens as stable hashes and rotates raw values', () => {
    const service = new AuthService({} as never, {} as never);
    const a = service.newRefreshToken();
    const b = service.newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashRefreshToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});
