import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildHelmetMiddleware, permissionsPolicyMiddleware } from './security-headers';

function appWith(production: boolean) {
  const app = express();
  app.use(buildHelmetMiddleware({ production }));
  app.use(permissionsPolicyMiddleware);
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('security headers', () => {
  it('sets a restrictive Content-Security-Policy with no wildcard directives', async () => {
    const res = await request(appWith(false)).get('/x').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('*');
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(appWith(false)).get('/x').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets a no-referrer Referrer-Policy', async () => {
    const res = await request(appWith(false)).get('/x').expect(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('sets a restrictive Permissions-Policy denying camera/microphone/geolocation', async () => {
    const res = await request(appWith(false)).get('/x').expect(200);
    const policy = res.headers['permissions-policy'];
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  it('sets Strict-Transport-Security only in production', async () => {
    const dev = await request(appWith(false)).get('/x').expect(200);
    expect(dev.headers['strict-transport-security']).toBeUndefined();
    const prod = await request(appWith(true)).get('/x').expect(200);
    expect(prod.headers['strict-transport-security']).toContain('max-age=');
  });

  it('sets Cross-Origin-Resource-Policy: same-site', async () => {
    const res = await request(appWith(false)).get('/x').expect(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
  });
});
