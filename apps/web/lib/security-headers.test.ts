import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, buildCsp, generateNonce, originOf } from './security-headers';

describe('generateNonce', () => {
  it('produces a non-empty, url-safe value that differs across calls', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[a-f0-9]+$/);
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toBe(b);
  });
});

describe('buildCsp', () => {
  it('embeds the exact nonce in script-src, never in style-src', () => {
    const csp = buildCsp('abc123', 'https://api.example.com', true);
    expect(csp).toContain(`script-src 'self' 'nonce-abc123'`);
    expect(csp).not.toMatch(/style-src[^;]*nonce/);
  });

  it('includes the API origin in connect-src and img-src', () => {
    const csp = buildCsp('n', 'https://api.example.com', true);
    expect(csp).toContain('connect-src \'self\' https://api.example.com');
    expect(csp).toContain('img-src \'self\' data: https://api.example.com');
  });

  it('never contains a wildcard directive', () => {
    const csp = buildCsp('n', 'https://api.example.com', true);
    expect(csp).not.toContain("'*'");
    expect(csp).not.toMatch(/-src[^;]*\*/);
  });

  it('denies framing and disallows unsafe-inline/unsafe-eval in production', () => {
    const csp = buildCsp('n', 'https://api.example.com', true);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows unsafe-eval outside production only, for React dev-mode debugging', () => {
    const dev = buildCsp('n', 'https://api.example.com', false);
    expect(dev).toContain("script-src 'self' 'nonce-n' 'unsafe-eval'");
    const prod = buildCsp('n', 'https://api.example.com', true);
    expect(prod).not.toContain('unsafe-eval');
  });

  it('only upgrades insecure requests in production', () => {
    expect(buildCsp('n', 'https://api.example.com', true)).toContain('upgrade-insecure-requests');
    expect(buildCsp('n', 'https://api.example.com', false)).not.toContain(
      'upgrade-insecure-requests',
    );
  });

});

describe('originOf', () => {
  it('extracts the origin from a valid URL', () => {
    expect(originOf('https://api.example.com/v1/foo')).toBe('https://api.example.com');
  });

  it('falls back to \'self\' for an unparseable URL', () => {
    expect(originOf('not-a-url')).toBe("'self'");
  });
});

describe('applySecurityHeaders', () => {
  const csp = buildCsp('the-nonce', 'https://api.example.com', true);

  it('sets every required header from the given csp string', () => {
    const response = applySecurityHeaders(new Response(null), { csp, isProduction: true });
    expect(response.headers.get('Content-Security-Policy')).toBe(csp);
    expect(response.headers.get('Content-Security-Policy')).toContain('the-nonce');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('only sends HSTS in production', () => {
    const prod = applySecurityHeaders(new Response(null), { csp, isProduction: true });
    expect(prod.headers.get('Strict-Transport-Security')).toBeTruthy();

    const dev = applySecurityHeaders(new Response(null), { csp, isProduction: false });
    expect(dev.headers.get('Strict-Transport-Security')).toBeNull();
  });
});
