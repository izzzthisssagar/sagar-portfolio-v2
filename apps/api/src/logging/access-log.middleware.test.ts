import { describe, expect, it, vi } from 'vitest';
import { createAccessLogMiddleware } from './access-log.middleware';
import { StructuredLogger } from './structured-logger';

function fakeRes() {
  const listeners: Record<string, () => void> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    finish: () => listeners.finish?.(),
  };
}

describe('createAccessLogMiddleware', () => {
  it('logs one structured line per request after the response finishes', () => {
    const write = vi.fn();
    const logger = new StructuredLogger({
      serviceName: 's',
      releaseSha: 'x',
      format: 'json',
      level: 'debug',
      write,
    });
    const middleware = createAccessLogMiddleware(logger);
    const req = {
      method: 'GET',
      path: '/api/v1/projects',
      route: { path: '/api/v1/projects' },
      id: 'req-1',
    };
    const res = fakeRes();
    const next = vi.fn();

    middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();

    res.statusCode = 200;
    res.finish();

    expect(write).toHaveBeenCalledOnce();
    const entry = JSON.parse(write.mock.calls[0]![0] as string);
    expect(entry).toMatchObject({
      message: 'http_request',
      requestId: 'req-1',
      method: 'GET',
      route: '/api/v1/projects',
      statusCode: 200,
    });
    expect(typeof entry.durationMs).toBe('number');
  });

  it('falls back to the raw path when no route matched (e.g. a 404)', () => {
    const write = vi.fn();
    const logger = new StructuredLogger({
      serviceName: 's',
      releaseSha: 'x',
      format: 'json',
      level: 'debug',
      write,
    });
    const middleware = createAccessLogMiddleware(logger);
    const req = { method: 'GET', path: '/api/v1/does-not-exist', id: 'req-2' };
    const res = fakeRes();
    res.statusCode = 404;
    middleware(req as never, res as never, vi.fn());
    res.finish();
    const entry = JSON.parse(write.mock.calls[0]![0] as string);
    expect(entry.route).toBe('/api/v1/does-not-exist');
    expect(entry.statusCode).toBe(404);
  });
});
