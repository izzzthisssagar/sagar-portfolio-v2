import { describe, expect, it, vi } from 'vitest';
import { StructuredLogger } from './structured-logger';

function setup(overrides?: Partial<Parameters<typeof StructuredLogger.prototype.log>>) {
  void overrides;
  const write = vi.fn();
  const logger = new StructuredLogger({
    serviceName: 'test-service',
    releaseSha: 'sha123',
    format: 'json',
    level: 'debug',
    write,
  });
  return { logger, write };
}

describe('StructuredLogger', () => {
  it('emits valid JSON with the expected top-level fields', () => {
    const { logger, write } = setup();
    logger.logStructured('info', 'something happened', { requestId: 'r1' });
    const line = write.mock.calls[0]![0] as string;
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({
      level: 'info',
      service: 'test-service',
      releaseSha: 'sha123',
      message: 'something happened',
      requestId: 'r1',
    });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('redacts sensitive fields before serializing', () => {
    const { logger, write } = setup();
    logger.logStructured('info', 'login attempt', {
      accessToken: 'super-secret',
      password: 'hunter2',
      email: 'user@example.invalid',
    });
    const line = write.mock.calls[0]![0] as string;
    expect(line).not.toContain('super-secret');
    expect(line).not.toContain('hunter2');
    expect(line).toContain('user@example.invalid');
  });

  it('filters below the configured level', () => {
    const write = vi.fn();
    const logger = new StructuredLogger({
      serviceName: 's',
      releaseSha: 'x',
      format: 'json',
      level: 'warn',
      write,
    });
    logger.log('info-level message');
    logger.debug('debug-level message');
    expect(write).not.toHaveBeenCalled();
    logger.warn('warn-level message');
    logger.error('error-level message');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('produces a human-readable pretty line in non-json format', () => {
    const write = vi.fn();
    const logger = new StructuredLogger({
      serviceName: 's',
      releaseSha: 'x',
      format: 'pretty',
      level: 'debug',
      write,
    });
    logger.log('hello world');
    const line = write.mock.calls[0]![0] as string;
    expect(() => JSON.parse(line)).toThrow();
    expect(line).toContain('hello world');
  });

  it('satisfies the Nest LoggerService surface (log/error/warn/debug/verbose)', () => {
    const { logger, write } = setup();
    logger.log('a');
    logger.error('b', 'trace-here');
    logger.warn('c');
    logger.debug('d');
    logger.verbose('e');
    expect(write).toHaveBeenCalledTimes(5);
  });

  it('includes a stack/trace field on error() without leaking it into the message', () => {
    const { logger, write } = setup();
    logger.error('failed', 'Error: boom\n  at x');
    const entry = JSON.parse(write.mock.calls[0]![0] as string);
    expect(entry.message).toBe('failed');
    expect(entry.trace).toContain('boom');
  });
});
