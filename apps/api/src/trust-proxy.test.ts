import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

/**
 * Exercises the exact Express mechanism `configureApp` wires up
 * (`app.getHttpAdapter().getInstance().set('trust proxy', ...)`) directly, rather than through a
 * full Nest app — `getConfig()` is a memoized singleton keyed to the real `process.env` (see
 * docs/runtime-configuration.md), so a test that needs a different `TRUST_PROXY` value than every
 * other integration test in the same worker can't safely go through it. This proves the
 * underlying trust-proxy behavior the wiring depends on.
 */
function appWithTrustProxy(value: number | false) {
  const app = express();
  app.set('trust proxy', value);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

describe('trust proxy behavior', () => {
  it('ignores a spoofed X-Forwarded-For when proxy trust is disabled (TRUST_PROXY=false)', async () => {
    const res = await request(appWithTrustProxy(false))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99')
      .expect(200);
    // supertest connects over a local loopback socket — never the spoofed header value.
    expect(res.body.ip).not.toBe('203.0.113.99');
  });

  it('honors X-Forwarded-For from exactly one trusted hop (TRUST_PROXY=1)', async () => {
    const res = await request(appWithTrustProxy(1))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.99')
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.99');
  });

  it('with one trusted hop, only the closest-to-origin address in a forwarded chain is honored', async () => {
    // X-Forwarded-For lists client-first; with exactly one trusted hop, Express takes the
    // right-most untrusted entry — the address the one trusted proxy itself reported.
    const res = await request(appWithTrustProxy(1))
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.99')
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.99');
  });
});
