import { describe, expect, it } from 'vitest';
import { loadWebConfig } from './env';

describe('loadWebConfig', () => {
  it('accepts a minimal development environment with defaults', () => {
    const result = loadWebConfig({});
    expect(result.ok).toBe(true);
    expect(result.config?.NEXT_PUBLIC_API_URL).toBe('http://localhost:4000/api/v1');
    expect(result.config?.ALLOW_STATIC_CONTENT_FALLBACK).toBe(false);
  });

  it('rejects a malformed NEXT_PUBLIC_API_URL', () => {
    const result = loadWebConfig({ NEXT_PUBLIC_API_URL: 'not-a-url' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('NEXT_PUBLIC_API_URL');
  });

  it('requires PUBLIC_SITE_URL in production', () => {
    const result = loadWebConfig({ NODE_ENV: 'production' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('PUBLIC_SITE_URL');
  });

  it('accepts production with PUBLIC_SITE_URL set', () => {
    const result = loadWebConfig({
      NODE_ENV: 'production',
      PUBLIC_SITE_URL: 'https://example.com',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects ALLOW_STATIC_CONTENT_FALLBACK=true in production', () => {
    const result = loadWebConfig({
      NODE_ENV: 'production',
      PUBLIC_SITE_URL: 'https://example.com',
      ALLOW_STATIC_CONTENT_FALLBACK: 'true',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('ALLOW_STATIC_CONTENT_FALLBACK');
  });

  it('allows ALLOW_STATIC_CONTENT_FALLBACK=true outside production', () => {
    const result = loadWebConfig({ ALLOW_STATIC_CONTENT_FALLBACK: 'true' });
    expect(result.ok).toBe(true);
    expect(result.config?.ALLOW_STATIC_CONTENT_FALLBACK).toBe(true);
  });

  it('rejects a malformed PUBLIC_SITE_URL', () => {
    const result = loadWebConfig({
      NODE_ENV: 'production',
      PUBLIC_SITE_URL: 'not-a-url',
    });
    expect(result.ok).toBe(false);
  });
});
