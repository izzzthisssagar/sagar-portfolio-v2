import { describe, expect, it, vi } from 'vitest';
import { REQUEST_ID_HEADER, requestIdMiddleware, resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('accepts a well-formed caller-supplied id', () => {
    expect(resolveRequestId('abc-123_DEF')).toBe('abc-123_DEF');
  });

  it('generates a fresh id when none is supplied', () => {
    const id = resolveRequestId(undefined);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates a fresh id for a non-string header value', () => {
    const id = resolveRequestId(['a', 'b']);
    expect(typeof id).toBe('string');
  });

  it('generates a fresh id when the supplied value is too long', () => {
    const tooLong = 'a'.repeat(200);
    expect(resolveRequestId(tooLong)).not.toBe(tooLong);
  });

  it('generates a fresh id when the supplied value contains unsafe characters', () => {
    expect(resolveRequestId('has spaces')).not.toBe('has spaces');
    expect(resolveRequestId('has\nnewline')).not.toBe('has\nnewline');
    expect(resolveRequestId('<script>')).not.toBe('<script>');
  });

  it('generates two different ids on two separate calls with no input', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});

function fakeReqRes(headers: Record<string, unknown>) {
  const req = { headers } as unknown as Parameters<typeof requestIdMiddleware>[0] & {
    id?: string;
  };
  const res = { setHeader: vi.fn() } as unknown as Parameters<typeof requestIdMiddleware>[1];
  return { req, res };
}

describe('requestIdMiddleware', () => {
  it('attaches the resolved id to the request and echoes it on the response', () => {
    const { req, res } = fakeReqRes({ [REQUEST_ID_HEADER]: 'caller-supplied-id' });
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(req.id).toBe('caller-supplied-id');
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'caller-supplied-id');
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates an id when the header is absent', () => {
    const { req, res } = fakeReqRes({});
    requestIdMiddleware(req, res, vi.fn());
    expect(req.id).toBeTruthy();
  });
});
