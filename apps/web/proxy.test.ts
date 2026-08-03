// @vitest-environment node
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const secret = 'test-access-token-secret-at-least-32-characters';
const issuer = 'portfolio-api-test';
const audience = 'portfolio-cms-test';

async function token(
  options: {
    signingSecret?: string;
    role?: string;
    subject?: string;
    expiresAt?: number | null;
    issuer?: string;
    audience?: string;
  } = {},
) {
  let builder = new SignJWT({ role: options.role ?? 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject ?? 'admin-1')
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt();
  if (options.expiresAt !== null) {
    builder = builder.setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 300);
  }
  return builder.sign(new TextEncoder().encode(options.signingSecret ?? secret));
}

function request(cookie?: string, extraCookies?: Record<string, string>) {
  const cookieParts = [
    ...(cookie ? [`portfolio_access=${cookie}`] : []),
    ...Object.entries(extraCookies ?? {}).map(([name, value]) => `${name}=${value}`),
  ];
  return new NextRequest('http://localhost:3000/admin/dashboard', {
    ...(cookieParts.length ? { headers: { cookie: cookieParts.join('; ') } } : {}),
  });
}

describe('admin proxy JWT boundary', () => {
  beforeAll(() => {
    process.env.ACCESS_TOKEN_SECRET = secret;
    process.env.ACCESS_TOKEN_ISSUER = issuer;
    process.env.ACCESS_TOKEN_AUDIENCE = audience;
  });

  it.each([
    ['missing cookie', undefined],
    ['arbitrary cookie', 'anything'],
    ['malformed JWT', 'abc.def.ghi'],
  ])('redirects a %s', async (_label, value) => {
    const { proxy } = await import('./proxy');
    const response = await proxy(request(value));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/admin/login');
  });

  it('redirects an incorrectly signed JWT', async () => {
    const { proxy } = await import('./proxy');
    expect((await proxy(request(await token({ signingSecret: `${secret}-forged` })))).status).toBe(
      307,
    );
  });

  it('redirects an expired JWT', async () => {
    const { proxy } = await import('./proxy');
    expect(
      (await proxy(request(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 })))).status,
    ).toBe(307);
  });

  it('redirects a non-admin JWT', async () => {
    const { proxy } = await import('./proxy');
    expect((await proxy(request(await token({ role: 'viewer' })))).status).toBe(307);
  });

  it.each([
    ['missing expiration', { expiresAt: null }],
    ['wrong issuer', { issuer: 'forged-issuer' }],
    ['wrong audience', { audience: 'forged-audience' }],
    ['missing subject', { subject: '' }],
  ])('redirects a token with %s', async (_label, claims) => {
    const { proxy } = await import('./proxy');
    expect((await proxy(request(await token(claims)))).status).toBe(307);
  });

  it('permits a valid administrator JWT', async () => {
    const { proxy } = await import('./proxy');
    const response = await proxy(request(await token()));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects back to the original URL with rotated cookies instead of continuing the stale request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: [
          ['set-cookie', 'portfolio_access=new-access-token; Path=/; HttpOnly'],
          ['set-cookie', 'portfolio_refresh=new-refresh-token; Path=/api/v1/auth; HttpOnly'],
        ],
      }),
    );
    const { proxy } = await import('./proxy');
    const response = await proxy(
      request(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 }), {
        portfolio_refresh: 'a-refresh-token',
        portfolio_csrf: 'a-csrf-token',
      }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      expect.objectContaining({ method: 'POST' }),
    );
    // Must NOT continue the original (stale-cookie) request — downstream
    // server components would still see the expired access cookie.
    expect(response.headers.get('x-middleware-next')).not.toBe('1');
    expect(response.status).toBe(307);
    // Redirects back to the same URL the browser originally requested.
    expect(response.headers.get('location')).toBe('http://localhost:3000/admin/dashboard');
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('portfolio_access=new-access-token'))).toBe(true);
    expect(setCookies.some((c) => c.startsWith('portfolio_refresh=new-refresh-token'))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('preserves query parameters on the post-refresh redirect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: [['set-cookie', 'portfolio_access=new-token; Path=/; HttpOnly']],
      }),
    );
    const { proxy } = await import('./proxy');
    const req = new NextRequest('http://localhost:3000/admin/projects?page=2&status=draft', {
      headers: {
        cookie: [
          `portfolio_access=${await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 })}`,
          'portfolio_refresh=a-refresh-token',
          'portfolio_csrf=a-csrf-token',
        ].join('; '),
      },
    });
    const response = await proxy(req);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/projects?page=2&status=draft',
    );
    fetchSpy.mockRestore();
  });

  it('does not attempt a second refresh after a refreshed redirect still fails to authenticate (loop prevention)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { proxy } = await import('./proxy');
    const req = request(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 }), {
      portfolio_refresh: 'a-refresh-token',
      portfolio_csrf: 'a-csrf-token',
      portfolio_refresh_attempt: '1',
    });
    const response = await proxy(req);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/admin/login');
    fetchSpy.mockRestore();
  });

  it('redirects to login when the silent refresh attempt fails', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 401 }));
    const { proxy } = await import('./proxy');
    const response = await proxy(
      request(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 }), {
        portfolio_refresh: 'a-stale-refresh-token',
        portfolio_csrf: 'a-csrf-token',
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/admin/login');
    fetchSpy.mockRestore();
  });

  it('redirects to login without attempting a refresh when no refresh cookie exists', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { proxy } = await import('./proxy');
    const response = await proxy(
      request(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 })),
    );
    expect(response.status).toBe(307);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
