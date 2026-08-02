import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
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

function validateOrigin(request: Request) {
  const expectedOrigin = process.env.WEB_URL ?? 'http://localhost:3000';
  const origin = request.headers.origin;
  if (origin && origin !== expectedOrigin) rejectOrigin();

  const apiUrl = process.env.API_URL;
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
