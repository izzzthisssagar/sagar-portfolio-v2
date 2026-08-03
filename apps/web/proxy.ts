import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccessToken } from './lib/admin-auth.server';
import { safeReturnTo } from './lib/safe-redirect';

const API_URL = process.env.API_URL
  ? `${process.env.API_URL}/api/v1`
  : 'http://localhost:4000/api/v1';

/** Marks that this navigation already went through a refresh redirect once,
 * so a still-invalid access token on the reissued request goes straight to
 * login instead of refreshing again forever. Short-lived: it only needs to
 * survive the single redirect round trip. */
const REFRESH_ATTEMPT_COOKIE = 'portfolio_refresh_attempt';

function redirectToLogin(request: NextRequest) {
  const login = new URL('/admin/login', request.url);
  login.searchParams.set(
    'returnTo',
    safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
  );
  const response = NextResponse.redirect(login);
  response.cookies.delete(REFRESH_ATTEMPT_COOKIE);
  return response;
}

/**
 * On an expired/missing access token, attempts a silent refresh using the
 * refresh cookie — matches the API's own CSRF requirements (Origin header +
 * double-submit token) since this is effectively a cookie-authenticated
 * mutating request.
 *
 * A successful refresh redirects back to the original URL with the rotated
 * cookies attached, rather than continuing the original request: downstream
 * server components (e.g. the CMS layout) independently re-read
 * `portfolio_access` from the incoming request, so continuing on would still
 * hand them the stale, expired cookie. Only a real round trip — browser
 * stores the Set-Cookie headers, then reissues the request — gives
 * downstream code a request it can trust.
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

    const response = NextResponse.redirect(new URL(request.url));
    // `response.cookies.set()` regenerates the whole Set-Cookie header stack
    // from Next's internal cookie jar, which would silently drop any cookie
    // appended directly to `response.headers` beforehand — so the jar-based
    // write goes first, and the raw forwarded API cookies are appended after.
    response.cookies.set(REFRESH_ATTEMPT_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/admin',
      maxAge: 10,
    });
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

  // Already redirected through a refresh once for this navigation and still
  // no valid access token — refreshing again would loop. Fail to login.
  if (request.cookies.get(REFRESH_ATTEMPT_COOKIE)) return redirectToLogin(request);

  const refreshed = await tryRefresh(request);
  if (refreshed) return refreshed;

  return redirectToLogin(request);
}

export const config = { matcher: ['/admin/:path*'] };
