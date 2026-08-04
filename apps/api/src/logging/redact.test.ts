import { describe, expect, it } from 'vitest';
import { redact, redactHeaders } from './redact';

describe('redact', () => {
  it('redacts known sensitive keys at the top level', () => {
    const result = redact({ password: 'hunter2', name: 'ok' }) as Record<string, unknown>;
    expect(result.password).toBe('[redacted]');
    expect(result.name).toBe('ok');
  });

  it('redacts sensitive keys nested arbitrarily deep', () => {
    const result = redact({
      a: { b: { c: { accessToken: 'secret-jwt-value' } } },
    }) as { a: { b: { c: { accessToken: string } } } };
    expect(result.a.b.c.accessToken).toBe('[redacted]');
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = redact({ items: [{ token: 'x' }, { safe: 'y' }] }) as {
      items: [{ token: string }, { safe: string }];
    };
    expect(result.items[0].token).toBe('[redacted]');
    expect(result.items[1].safe).toBe('y');
  });

  it('matches case-insensitively and by substring (SMTP_PASSWORD, ACCESS_TOKEN, etc.)', () => {
    const result = redact({
      SMTP_PASSWORD: 'x',
      Authorization: 'Bearer y',
      DATABASE_URL: 'postgres://...',
      cookie: 'z',
      apiKey: 'k',
    }) as Record<string, unknown>;
    for (const value of Object.values(result)) expect(value).toBe('[redacted]');
  });

  it('leaves non-sensitive primitives, numbers, and booleans untouched', () => {
    const result = redact({ count: 3, ok: true, name: 'evidence.png' }) as Record<string, unknown>;
    expect(result).toEqual({ count: 3, ok: true, name: 'evidence.png' });
  });

  it('does not mutate the input', () => {
    const input = { password: 'hunter2' };
    redact(input);
    expect(input.password).toBe('hunter2');
  });

  it('returns non-object values unchanged', () => {
    expect(redact('a string')).toBe('a string');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('redactHeaders', () => {
  it('redacts authorization, cookie, and csrf/health-token headers by name', () => {
    const result = redactHeaders({
      authorization: 'Bearer x',
      cookie: 'portfolio_access=y',
      'set-cookie': 'a=b',
      'x-csrf-token': 'z',
      'x-health-token': 'w',
      'content-type': 'application/json',
    });
    expect(result.authorization).toBe('[redacted]');
    expect(result.cookie).toBe('[redacted]');
    expect(result['set-cookie']).toBe('[redacted]');
    expect(result['x-csrf-token']).toBe('[redacted]');
    expect(result['x-health-token']).toBe('[redacted]');
    expect(result['content-type']).toBe('application/json');
  });
});
