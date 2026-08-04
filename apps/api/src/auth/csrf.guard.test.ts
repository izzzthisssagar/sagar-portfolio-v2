import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '../config';
import { CsrfGuard } from './csrf.guard';

const productionReadyEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  WEB_URL: 'https://app.example.com',
  API_URL: 'https://api.example.com',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  ACCESS_TOKEN_ISSUER: 'issuer',
  ACCESS_TOKEN_AUDIENCE: 'audience',
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
  MEDIA_STORAGE_DRIVER: 's3',
  MEDIA_STORAGE_REGION: 'us-east-1',
  MEDIA_STORAGE_BUCKET: 'bucket',
  MEDIA_STORAGE_ACCESS_KEY: 'key',
  MEDIA_STORAGE_SECRET_KEY: 'secret',
  CONTACT_NOTIFICATION_DRIVER: 'smtp',
  SMTP_HOST: 'smtp.example.invalid',
  SMTP_PORT: '587',
  SMTP_USERNAME: 'u',
  SMTP_PASSWORD: 'p',
  SMTP_FROM: 'from@example.invalid',
  CONTACT_NOTIFICATION_TO: 'to@example.invalid',
};

interface FakeRequestInit {
  method?: string;
  headers?: Record<string, string | undefined>;
  cookies?: Record<string, string>;
}

function fakeContext(init: FakeRequestInit): ExecutionContext {
  const request = {
    method: init.method ?? 'POST',
    headers: init.headers ?? {},
    cookies: init.cookies ?? {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
  } as unknown as ExecutionContext;
}

describe('CsrfGuard — Origin/Host enforcement (production-style configuration)', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    resetConfigCache();
    process.env = { ...productionReadyEnv };
    guard = new CsrfGuard(new Reflector());
  });

  afterEach(() => {
    resetConfigCache();
  });

  it('allows safe methods (GET) through without any Origin/Host check', () => {
    const context = fakeContext({
      method: 'GET',
      headers: { origin: 'https://attacker.example.invalid' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a wrong Origin under production-style configuration', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://attacker.example.invalid',
        host: 'api.example.com',
        'x-csrf-token': 'token',
      },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: 'CSRF_ORIGIN_REJECTED',
      });
    }
  });

  it('rejects a wrong Host under production-style configuration, even with a correct Origin', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        host: 'attacker.example.invalid',
        'x-csrf-token': 'token',
      },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('passes with a valid Origin and a valid Host, and a matching double-submit token', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        host: 'api.example.com',
        'x-csrf-token': 'token',
      },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('a Bearer-token request still enforces Origin — the CSRF *token* exemption does not bypass it', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://attacker.example.invalid',
        host: 'api.example.com',
        authorization: 'Bearer some-real-access-token',
      },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('a Bearer-token request still enforces Host — the CSRF *token* exemption does not bypass it', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        host: 'attacker.example.invalid',
        authorization: 'Bearer some-real-access-token',
      },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('a Bearer-token request with valid Origin/Host is exempt from the double-submit token check', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        host: 'api.example.com',
        authorization: 'Bearer some-real-access-token',
      },
      // Deliberately no CSRF cookie/header — proves the token check itself was skipped, not that
      // it happened to pass.
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('an absent Origin header (a non-browser same-origin caller) does not itself fail Origin checks', () => {
    // No Origin header at all — validateOrigin only rejects when an Origin is *present and
    // wrong*; Host enforcement still applies.
    const context = fakeContext({
      method: 'POST',
      headers: { host: 'api.example.com', 'x-csrf-token': 'token' },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('CsrfGuard — development/test configuration (no explicit API_URL)', () => {
  let guard: CsrfGuard;

  beforeEach(() => {
    resetConfigCache();
    process.env = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      WEB_URL: 'http://127.0.0.1:3000',
      ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      ACCESS_TOKEN_ISSUER: 'issuer',
      ACCESS_TOKEN_AUDIENCE: 'audience',
      REFRESH_TOKEN_SECRET: 'b'.repeat(32),
    };
    guard = new CsrfGuard(new Reflector());
  });

  afterEach(() => {
    resetConfigCache();
  });

  it('skips Host enforcement when API_URL is unset — an in-process Supertest server is never bound to a configured API_URL', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:3000',
        host: '127.0.0.1:54321', // an arbitrary ephemeral supertest port, never configured anywhere
        'x-csrf-token': 'token',
      },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still enforces Origin even with API_URL unset', () => {
    const context = fakeContext({
      method: 'POST',
      headers: {
        origin: 'https://attacker.example.invalid',
        'x-csrf-token': 'token',
      },
      cookies: { portfolio_csrf: 'token' },
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
