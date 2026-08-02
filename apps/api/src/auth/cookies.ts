import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_SECONDS, REFRESH_TOKEN_SECONDS } from './token-lifetimes';

export const ACCESS_TOKEN_COOKIE = 'portfolio_access';
export const REFRESH_TOKEN_COOKIE = 'portfolio_refresh';
export const CSRF_TOKEN_COOKIE = 'portfolio_csrf';

const AUTH_PATH = '/api/v1/auth';

const isProduction = () => process.env.NODE_ENV === 'production';

const baseCookie: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: isProduction(),
};

export function setAccessCookie(response: Response, token: string) {
  response.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookie,
    path: '/',
    maxAge: ACCESS_TOKEN_SECONDS * 1000,
  });
}

export function setRefreshCookie(response: Response, token: string) {
  response.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookie,
    path: AUTH_PATH,
    maxAge: REFRESH_TOKEN_SECONDS * 1000,
  });
}

/** Double-submit token: readable by client JS by design, never a secret on its own. */
export function setCsrfCookie(response: Response, token: string) {
  response.cookie(CSRF_TOKEN_COOKIE, token, {
    sameSite: 'strict',
    secure: isProduction(),
    httpOnly: false,
    path: '/',
    maxAge: REFRESH_TOKEN_SECONDS * 1000,
  });
}

export function clearAuthCookies(response: Response) {
  response.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookie, path: '/' });
  response.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseCookie, path: AUTH_PATH });
  response.clearCookie(CSRF_TOKEN_COOKIE, {
    sameSite: 'strict',
    secure: isProduction(),
    httpOnly: false,
    path: '/',
  });
}
