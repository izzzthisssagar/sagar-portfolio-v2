import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccessToken } from './lib/admin-auth.server';
import { safeReturnTo } from './lib/safe-redirect';
import { applySecurityHeaders, buildCsp, generateNonce, originOf } from './lib/security-headers';

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

/** `requestHeaders` (with `x-nonce` already set) is threaded through so downstream Server
 * Components can read the same nonce back via `next/headers` — see lib/seo.tsx's `JsonLd`. */
function next(requestHeaders: Headers) {
  return NextResponse.next({ request: { headers: requestHeaders } });
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
  const isProduction = process.env.NODE_ENV === 'production';
  const nonce = generateNonce();
  const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1');
  const csp = buildCsp(nonce, apiOrigin, isProduction);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Required, not just the response header below — this is how Next.js knows to apply the same
  // nonce to its own framework-injected inline scripts (hydration bootstrap, RSC payload), not
  // only the app's own JsonLd script. See lib/security-headers.ts's applySecurityHeaders docblock.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = await route(request, requestHeaders);

  return applySecurityHeaders(response, { csp, isProduction });
}

/** The admin-session logic below only applies under `/admin` — every other path just gets the
 * nonce-carrying pass-through response `proxy()` then attaches security headers to. */
async function route(request: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
  if (!request.nextUrl.pathname.startsWith('/admin')) return next(requestHeaders);
  if (request.nextUrl.pathname === '/admin/login') return next(requestHeaders);

  const claims = await verifyAdminAccessToken(request.cookies.get('portfolio_access')?.value);
  if (claims) return next(requestHeaders);

  // Already redirected through a refresh once for this navigation and still
  // no valid access token — refreshing again would loop. Fail to login.
  if (request.cookies.get(REFRESH_ATTEMPT_COOKIE)) return redirectToLogin(request);

  const refreshed = await tryRefresh(request);
  if (refreshed) return refreshed;

  return redirectToLogin(request);
}

// Every path except static assets and the framework's own internals — security headers (CSP
// included) must apply everywhere, not just /admin. next/image optimizer output is excluded
// since it's binary image data, not HTML that could carry an injected script.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.\\w+$).*)'],
};
