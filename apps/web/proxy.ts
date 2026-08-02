import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccessToken } from './lib/admin-auth.server';

const API_URL = process.env.API_URL ? `${process.env.API_URL}/api/v1` : 'http://localhost:4000/api/v1';

function redirectToLogin(request: NextRequest) {
  const login = new URL('/admin/login', request.url);
  login.searchParams.set('returnTo', request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

/**
 * On an expired/missing access token, attempts a silent refresh using the
 * refresh cookie before falling back to a login redirect — matches the
 * API's own CSRF requirements (Origin header + double-submit token) since
 * this is effectively a cookie-authenticated mutating request.
 */
async function tryRefresh(request: NextRequest): Promise<NextResponse | null> {
  const refreshToken = request.cookies.get('portfolio_refresh')?.value;
  const csrfToken = request.cookies.get('portfolio_csrf')?.value;
  if (!refreshToken || !csrfToken) return null;

  try {
    const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `portfolio_refresh=${refreshToken}; portfolio_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        origin: process.env.WEB_URL ?? 'http://localhost:3000',
      },
    });
    if (!refreshResponse.ok) return null;
    const setCookies = refreshResponse.headers.getSetCookie?.() ?? [];
    if (!setCookies.length) return null;
    const response = NextResponse.next();
    for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
    return response;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin/login') return NextResponse.next();
  const claims = await verifyAdminAccessToken(request.cookies.get('portfolio_access')?.value);
  if (claims) return NextResponse.next();

  const refreshed = await tryRefresh(request);
  if (refreshed) return refreshed;

  return redirectToLogin(request);
}

export const config = { matcher: ['/admin/:path*'] };
