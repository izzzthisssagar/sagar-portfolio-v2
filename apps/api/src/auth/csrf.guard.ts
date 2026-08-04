import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getConfig } from '../config';
import { CSRF_TOKEN_COOKIE } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_CSRF_TOKEN = 'skipCsrfToken';

/**
 * Marks a mutating route as exempt from the double-submit CSRF token check
 * (Origin/Host validation still applies). Used on `POST /auth/login`, which
 * mutates state before any session — and therefore any CSRF cookie — exists.
 */
export const SkipCsrfToken = () => SetMetadata(SKIP_CSRF_TOKEN, true);

function rejectOrigin(): never {
  throw new ForbiddenException({
    code: 'CSRF_ORIGIN_REJECTED',
    message: 'Cross-origin request rejected.',
  });
}

function rejectToken(): never {
  throw new ForbiddenException({
    code: 'CSRF_TOKEN_INVALID',
    message: 'CSRF token missing or invalid.',
  });
}

/**
 * Reads the *validated* configuration layer (`getConfig()`), never `process.env` directly — by
 * the time this guard runs, WEB_URL/API_URL have already gone through schema validation
 * (malformed URLs rejected) and, in production specifically, a fail-closed presence check (see
 * config/index.ts's `productionOnlyErrors`): production can never boot with either unset, so both
 * checks below are unconditionally active there. WEB_URL always has a value (a documented
 * `http://localhost:3000` development default when unset, matching Sprint 3 behavior); API_URL
 * stays genuinely optional outside production specifically so an in-process Supertest integration
 * test — whose ephemeral, OS-assigned port is never actually bound to any configured API_URL —
 * doesn't get Host-rejected for not pretending to be that host.
 */
function validateOrigin(request: Request) {
  const config = getConfig();
  const expectedOrigin = config.WEB_URL;
  const origin = request.headers.origin;
  if (origin && origin !== expectedOrigin) rejectOrigin();

  const apiUrl = config.API_URL;
  if (apiUrl) {
    const expectedHost = new URL(apiUrl).host;
    const actualHost = request.headers.host;
    if (actualHost && actualHost !== expectedHost) rejectOrigin();
  }
}

/**
 * Same-origin enforcement + double-submit CSRF token for cookie-authenticated
 * state-changing requests. Requests presenting an `Authorization: Bearer`
 * header are exempt from the token check: a cross-site attacker cannot make
 * the victim's browser attach a header it does not already know, so bearer
 * requests are not CSRF-able the way ambient cookies are.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;

    validateOrigin(request);

    const hasBearer = request.headers.authorization?.startsWith('Bearer ') ?? false;
    const skipToken = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_TOKEN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (hasBearer || skipToken) return true;

    const cookieToken = request.cookies?.[CSRF_TOKEN_COOKIE] as string | undefined;
    const headerToken = request.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) rejectToken();
    return true;
  }
}
