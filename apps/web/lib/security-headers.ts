/** Explicit, restrictive security headers for the web app — the API has its own equivalent
 * (apps/api/src/security-headers.ts); this is not shared code because the two apps have
 * genuinely different needs (a JSON API emitting security headers on every response vs. an HTML
 * app that also needs a real CSP for the browser to enforce).
 *
 * Mirrors the reasoning in apps/api/src/security-headers.ts: no wildcard directives, nothing
 * broader than what this specific app actually uses. `script-src` uses a per-request nonce
 * (applied to the one inline script this app renders — JSON-LD, see lib/seo.tsx's `JsonLd`
 * component) rather than 'unsafe-inline'; `style-src` has no 'unsafe-inline' either since this
 * codebase has no `style={{...}}` usage or scripted `style` attribute writes to accommodate
 * (verified by search, not assumed) — a future PR introducing either will need to revisit this. */
export function buildCsp(nonce: string, apiOrigin: string, isProduction: boolean): string {
  // React's dev-mode-only debugging (reconstructing component stacks) calls eval() — never in
  // production, per React's own console message — so 'unsafe-eval' is scoped to non-production
  // only, the same prod-vs-dev split already used below for upgrade-insecure-requests.
  const scriptSrc = isProduction
    ? `script-src 'self' 'nonce-${nonce}'`
    : `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`;
  const directives = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self'`,
    `img-src 'self' data: ${apiOrigin}`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin}`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  if (isProduction) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "'self'";
  }
}

/** Applies every security header to a response, given an already-built CSP string.
 *
 * The CSP has to be built once, up front (see proxy.ts) — not here — because it must also be set
 * on the *request* headers before Next.js renders, or Next won't apply the matching nonce to its
 * own framework-injected inline scripts (hydration bootstrap, RSC payload). Building it again
 * here from scratch would still produce the same string, but it's clearer for there to be exactly
 * one place that builds it and two places that attach it (request, then response). */
export function applySecurityHeaders(
  response: Response,
  opts: { csp: string; isProduction: boolean },
): Response {
  response.headers.set('Content-Security-Policy', opts.csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  // Only claimed under the documented production-behind-TLS assumption (docs/security-production.md)
  // — never sent in development/test, where the app is served over plain HTTP.
  if (opts.isProduction) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

/** A CSP nonce must be unpredictable per request — `crypto.randomUUID()` (Web Crypto, available
 * in both the Node and Edge proxy runtimes) is drawn from a CSPRNG, unlike `Math.random()`. */
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
