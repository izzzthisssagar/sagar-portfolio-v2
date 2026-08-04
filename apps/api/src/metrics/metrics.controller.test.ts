import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../config';
import type { HealthService } from '../health/health.service';
import { MetricsController } from './metrics.controller';
import { recordHttpRequest, resetMetricsForTests } from './registry';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  ACCESS_TOKEN_ISSUER: 'issuer',
  ACCESS_TOKEN_AUDIENCE: 'audience',
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
};

function fakeRes() {
  const res = { status: vi.fn(), header: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  res.header.mockReturnValue(res);
  return res;
}

function fakeHealthService(ok = true): HealthService {
  return {
    liveness: vi.fn(() => ({ status: 'ok' as const })),
    readiness: vi.fn(() => Promise.resolve({ ok, checks: [] })),
  } as unknown as HealthService;
}

describe('MetricsController', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
    resetMetricsForTests();
    process.env = { ...validEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('404s when METRICS_ENABLED is unset (disabled by default)', async () => {
    const controller = new MetricsController(fakeHealthService());
    await expect(controller.get('anything', fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails closed at boot — METRICS_ENABLED=true with no METRICS_TOKEN never starts the app', async () => {
    process.env.METRICS_ENABLED = 'true';
    resetConfigCache();
    // apps/api/src/config/index.ts's getConfig() is what the real bootstrap calls — it throws
    // before the app ever accepts a request, so this invalid state is unreachable at runtime;
    // there is no request for the controller's own guard to 404.
    const { getConfig } = await import('../config');
    expect(() => getConfig()).toThrow(/METRICS_TOKEN/);
  });

  it('404s when the caller presents no token', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    await expect(controller.get(undefined, fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the caller presents the wrong token', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    await expect(
      controller.get('the-wrong-token-entirely', fakeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the wrong token happens to share the same length as the real one', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    const sameLengthWrongToken = 'x'.repeat('a-real-metrics-token-value'.length);
    await expect(controller.get(sameLengthWrongToken, fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the wrong token is shorter than the real one', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    await expect(controller.get('short', fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the wrong token is longer than the real one', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    const longerWrongToken = `a-real-metrics-token-value-plus-some-more-characters-appended`;
    await expect(controller.get(longerWrongToken, fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the wrong token contains Unicode characters', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    await expect(
      controller.get('a-réal-mëtrics-tökén-välüé-日本語', fakeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a Unicode token when it is the exact configured value', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-réal-mëtrics-tökén-välüé-日本語-and-long-enough';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    const res = fakeRes();
    await controller.get('a-réal-mëtrics-tökén-välüé-日本語-and-long-enough', res as never);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('never passes the token or its comparison result to any logging call', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const logSpies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ];
    try {
      const controller = new MetricsController(fakeHealthService());
      await controller.get('a-wrong-token-entirely', fakeRes() as never).catch(() => {});
      await controller.get('a-real-metrics-token-value', fakeRes() as never);
      for (const spy of logSpies) {
        for (const call of spy.mock.calls) {
          const serialized = call.map((arg) => String(arg)).join(' ');
          expect(serialized).not.toContain('a-real-metrics-token-value');
          expect(serialized).not.toContain('a-wrong-token-entirely');
        }
      }
    } finally {
      for (const spy of logSpies) spy.mockRestore();
    }
  });

  it('responds 200 with the correct token, using the plain-text Prometheus content type', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService(true));
    const res = fakeRes();
    await controller.get('a-real-metrics-token-value', res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.header).toHaveBeenCalledWith('content-type', expect.stringContaining('text/plain'));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('process_uptime_seconds'));
  });

  it('reflects readiness status in the rendered output', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService(false));
    const res = fakeRes();
    await controller.get('a-real-metrics-token-value', res as never);
    const body = res.send.mock.calls[0]![0] as string;
    expect(body).toMatch(/readiness_status 0/);
  });

  it('increments http_requests_total when a request is recorded, and the output reflects it', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    recordHttpRequest({
      matchedRoute: '/api/v1/projects',
      method: 'GET',
      statusCode: 200,
      durationMs: 12.3,
    });
    const controller = new MetricsController(fakeHealthService());
    const res = fakeRes();
    await controller.get('a-real-metrics-token-value', res as never);
    const body = res.send.mock.calls[0]![0] as string;
    expect(body).toContain(
      'http_requests_total{method="GET",route="/api/v1/projects",status="2xx"} 1',
    );
  });

  it('never includes an unmatched (attacker-controlled) raw path as a label value', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    recordHttpRequest({
      matchedRoute: undefined,
      method: 'GET',
      statusCode: 404,
      durationMs: 1,
    });
    const controller = new MetricsController(fakeHealthService());
    const res = fakeRes();
    await controller.get('a-real-metrics-token-value', res as never);
    const body = res.send.mock.calls[0]![0] as string;
    expect(body).toContain('route="unmatched"');
  });

  it('never leaks secrets, tokens, cookies, or PII field names into the rendered output', async () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_TOKEN = 'a-real-metrics-token-value';
    resetConfigCache();
    const controller = new MetricsController(fakeHealthService());
    const res = fakeRes();
    await controller.get('a-real-metrics-token-value', res as never);
    const body = res.send.mock.calls[0]![0] as string;
    expect(body).not.toContain('a-real-metrics-token-value');
    expect(body.toLowerCase()).not.toMatch(
      /email|password|cookie|access.?token|refresh.?token|@example|requestid/,
    );
  });
});
