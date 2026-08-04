import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown } from './shutdown';

function fakeProcess() {
  const handlers = new Map<string, () => void>();
  return {
    on: vi.fn((signal: string, handler: () => void) => {
      handlers.set(signal, handler);
      return undefined as never;
    }),
    trigger: (signal: string) => handlers.get(signal)?.(),
  };
}

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the app and exits 0 on a clean shutdown', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const proc = fakeProcess();
    const shutdown = registerGracefulShutdown(
      { close },
      { gracePeriodMs: 5000, exit, logger, process: proc },
    );
    await shutdown('SIGTERM');
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-exits 1 when close() exceeds the grace period', async () => {
    const close = vi.fn(() => new Promise(() => {})); // never resolves
    const exit = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const proc = fakeProcess();
    const shutdown = registerGracefulShutdown(
      { close },
      { gracePeriodMs: 1000, exit, logger, process: proc },
    );
    const promise = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exceeded'));
  });

  it('exits 1 when close() rejects', async () => {
    const close = vi.fn().mockRejectedValue(new Error('boom'));
    const exit = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const proc = fakeProcess();
    const shutdown = registerGracefulShutdown(
      { close },
      { gracePeriodMs: 5000, exit, logger, process: proc },
    );
    await shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error while closing'),
      expect.any(Error),
    );
  });

  it('is idempotent — a second signal during an in-progress shutdown is a no-op', async () => {
    let resolveClose: () => void = () => {};
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const exit = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const proc = fakeProcess();
    const shutdown = registerGracefulShutdown(
      { close },
      { gracePeriodMs: 5000, exit, logger, process: proc },
    );
    const first = shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(close).toHaveBeenCalledTimes(1);
    resolveClose();
    await first;
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('registers handlers for both SIGTERM and SIGINT', () => {
    const proc = fakeProcess();
    registerGracefulShutdown(
      { close: vi.fn().mockResolvedValue(undefined) },
      { gracePeriodMs: 5000, process: proc },
    );
    expect(proc.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(proc.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('does not double-exit when close() resolves right at the grace-period boundary', async () => {
    const close = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 999)));
    const exit = vi.fn();
    const proc = fakeProcess();
    const shutdown = registerGracefulShutdown(
      { close },
      { gracePeriodMs: 1000, exit, process: proc },
    );
    const promise = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(999);
    await promise;
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
