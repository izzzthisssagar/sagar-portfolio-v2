import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../config';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  ACCESS_TOKEN_ISSUER: 'issuer',
  ACCESS_TOKEN_AUDIENCE: 'audience',
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
};

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function fakeHealthService(
  readinessResult: { ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } = {
    ok: true,
    checks: [],
  },
): HealthService {
  return {
    liveness: vi.fn(() => ({ status: 'ok' as const })),
    readiness: vi.fn(() => Promise.resolve(readinessResult)),
  } as unknown as HealthService;
}

describe('HealthController', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
    process.env = { ...validEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('live() returns the liveness result directly', () => {
    const health = fakeHealthService();
    const controller = new HealthController(health);
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('ready() responds 200 when healthy', async () => {
    const health = fakeHealthService({ ok: true, checks: [] });
    const controller = new HealthController(health);
    const res = fakeRes();
    await controller.ready(res as never);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('ready() responds 503 when a dependency is down', async () => {
    const health = fakeHealthService({
      ok: false,
      checks: [{ name: 'database', ok: false, detail: 'unavailable' }],
    });
    const controller = new HealthController(health);
    const res = fakeRes();
    await controller.ready(res as never);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('details() throws NotFoundException when no internal token is configured', async () => {
    const controller = new HealthController(fakeHealthService());
    await expect(controller.details(undefined, fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('details() throws NotFoundException when the wrong token is presented', async () => {
    process.env.HEALTH_INTERNAL_TOKEN = 'a-real-secret-token';
    resetConfigCache();
    const controller = new HealthController(fakeHealthService());
    await expect(controller.details('wrong-token', fakeRes() as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('details() responds with service/releaseSha when the correct token is presented', async () => {
    process.env.HEALTH_INTERNAL_TOKEN = 'a-real-secret-token';
    process.env.SERVICE_NAME = 'test-service';
    process.env.RELEASE_SHA = 'abc123';
    resetConfigCache();
    const health = fakeHealthService({ ok: true, checks: [] });
    const controller = new HealthController(health);
    const res = fakeRes();
    await controller.details('a-real-secret-token', res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'test-service', releaseSha: 'abc123' }),
    );
  });
});
