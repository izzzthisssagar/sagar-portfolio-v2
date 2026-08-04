import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service';

function setup(overrides?: {
  queryRaw?: () => Promise<unknown>;
  ping?: () => Promise<{ ok: boolean; detail?: string }>;
}) {
  const prisma = {
    $queryRaw: vi.fn(overrides?.queryRaw ?? (() => Promise.resolve([{ '?column?': 1 }]))),
  };
  const storage = {
    ping: vi.fn(overrides?.ping ?? (() => Promise.resolve({ ok: true }))),
  };
  return { service: new HealthService(prisma as never, storage as never), prisma, storage };
}

describe('HealthService', () => {
  const originalDriver = process.env.CONTACT_NOTIFICATION_DRIVER;
  const originalSmtpHost = process.env.SMTP_HOST;

  beforeEach(() => {
    delete process.env.CONTACT_NOTIFICATION_DRIVER;
    delete process.env.SMTP_HOST;
  });

  afterEach(() => {
    if (originalDriver === undefined) delete process.env.CONTACT_NOTIFICATION_DRIVER;
    else process.env.CONTACT_NOTIFICATION_DRIVER = originalDriver;
    if (originalSmtpHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = originalSmtpHost;
  });

  it('liveness never touches a dependency and always reports ok', () => {
    const { service, prisma, storage } = setup();
    expect(service.liveness()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(storage.ping).not.toHaveBeenCalled();
  });

  it('readiness reports ok when every dependency is healthy', async () => {
    const { service } = setup();
    const result = await service.readiness();
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name).sort()).toEqual([
      'database',
      'notification-config',
      'storage',
    ]);
  });

  it('reports database unavailable without leaking the underlying error', async () => {
    const { service } = setup({
      queryRaw: () => Promise.reject(new Error('password authentication failed for user "x"')),
    });
    const result = await service.readiness();
    expect(result.ok).toBe(false);
    const dbCheck = result.checks.find((c) => c.name === 'database');
    expect(dbCheck?.ok).toBe(false);
    expect(dbCheck?.detail).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('password authentication');
  });

  it('reports storage unavailable without leaking adapter detail', async () => {
    const { service } = setup({ ping: () => Promise.resolve({ ok: false, detail: 'boom' }) });
    const result = await service.readiness();
    expect(result.ok).toBe(false);
    const storageCheck = result.checks.find((c) => c.name === 'storage');
    expect(storageCheck?.ok).toBe(false);
    expect(storageCheck?.detail).toBe('unavailable');
  });

  it('reports storage unavailable when ping() itself throws', async () => {
    const { service } = setup({ ping: () => Promise.reject(new Error('network unreachable')) });
    const result = await service.readiness();
    expect(result.checks.find((c) => c.name === 'storage')?.ok).toBe(false);
  });

  it('reports notification-config incomplete when SMTP is selected but underspecified', async () => {
    process.env.CONTACT_NOTIFICATION_DRIVER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.invalid';
    // SMTP_PORT/USERNAME/PASSWORD/FROM left unset — this exact malformed-config state is what
    // this check exists to catch (see docs/operations.md).
    const { service } = setup();
    const result = await service.readiness();
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'notification-config')?.ok).toBe(false);
  });

  it('reports notification-config ok for the capture driver', async () => {
    const { service } = setup();
    const result = await service.readiness();
    expect(result.checks.find((c) => c.name === 'notification-config')?.ok).toBe(true);
  });

  it('liveness stays healthy while readiness reports every dependency down', async () => {
    const { service } = setup({
      queryRaw: () => Promise.reject(new Error('down')),
      ping: () => Promise.resolve({ ok: false }),
    });
    expect(service.liveness()).toEqual({ status: 'ok' });
    const result = await service.readiness();
    expect(result.ok).toBe(false);
  });
});
