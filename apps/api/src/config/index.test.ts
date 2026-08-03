import { describe, expect, it } from 'vitest';
import { loadAdminProvisioningConfig, loadConfig, loadConfigOrThrow } from './index';

const validEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  WEB_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  ACCESS_TOKEN_SECRET: 'a'.repeat(32),
  ACCESS_TOKEN_ISSUER: 'issuer',
  ACCESS_TOKEN_AUDIENCE: 'audience',
  REFRESH_TOKEN_SECRET: 'b'.repeat(32),
};

describe('loadConfig — core', () => {
  it('accepts a minimal valid environment with defaults applied', () => {
    const result = loadConfig(validEnv);
    expect(result.ok).toBe(true);
    expect(result.config?.PORT).toBe(4000);
    expect(result.config?.RATE_LIMIT_MAX).toBe(60);
    expect(result.config?.TRUST_PROXY).toBe('false');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    void DATABASE_URL;
    const result = loadConfig(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('DATABASE_URL');
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    const result = loadConfig({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('DATABASE_URL');
  });

  it('rejects a malformed WEB_URL', () => {
    const result = loadConfig({ ...validEnv, WEB_URL: 'not-a-url' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('WEB_URL');
  });

  it('rejects an out-of-range PORT', () => {
    expect(loadConfig({ ...validEnv, PORT: '0' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, PORT: '70000' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, PORT: 'not-a-number' }).ok).toBe(false);
  });

  it('rejects an unknown NODE_ENV value', () => {
    const result = loadConfig({ ...validEnv, NODE_ENV: 'staging' });
    expect(result.ok).toBe(false);
  });
});

describe('loadConfig — auth secrets', () => {
  it('rejects an access token secret shorter than 32 characters', () => {
    const result = loadConfig({ ...validEnv, ACCESS_TOKEN_SECRET: 'short' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('ACCESS_TOKEN_SECRET');
  });

  it('rejects a still-placeholder access token secret', () => {
    const result = loadConfig({ ...validEnv, ACCESS_TOKEN_SECRET: `replace-${'x'.repeat(30)}` });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('placeholder');
  });

  it('rejects a refresh token secret shorter than 32 characters', () => {
    const result = loadConfig({ ...validEnv, REFRESH_TOKEN_SECRET: 'short' });
    expect(result.ok).toBe(false);
  });

  it('rejects a zero, negative, or absurd REFRESH_TOKEN_TTL_DAYS', () => {
    expect(loadConfig({ ...validEnv, REFRESH_TOKEN_TTL_DAYS: '0' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, REFRESH_TOKEN_TTL_DAYS: '-1' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, REFRESH_TOKEN_TTL_DAYS: '9999' }).ok).toBe(false);
  });

  it('never includes the secret value itself in an error message', () => {
    const secretValue = 'super-secret-value-that-must-never-leak-anywhere-ok';
    const result = loadConfig({ ...validEnv, ACCESS_TOKEN_SECRET: secretValue });
    expect(JSON.stringify(result.errors)).not.toContain(secretValue);
  });
});

describe('loadConfig — media storage', () => {
  it('allows an unset MEDIA_STORAGE_DRIVER outside production (defaults to local)', () => {
    const result = loadConfig({ ...validEnv, NODE_ENV: 'development' });
    expect(result.ok).toBe(true);
  });

  it('requires MEDIA_STORAGE_DRIVER in production', () => {
    const result = loadConfig({ ...validEnv, NODE_ENV: 'production' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('MEDIA_STORAGE_DRIVER');
  });

  it('rejects an unknown MEDIA_STORAGE_DRIVER value', () => {
    const result = loadConfig({ ...validEnv, MEDIA_STORAGE_DRIVER: 'ftp' });
    expect(result.ok).toBe(false);
  });

  it('requires S3 fields when MEDIA_STORAGE_DRIVER=s3', () => {
    const result = loadConfig({ ...validEnv, MEDIA_STORAGE_DRIVER: 's3' });
    expect(result.ok).toBe(false);
    const joined = result.errors.join(' ');
    expect(joined).toContain('MEDIA_STORAGE_REGION');
    expect(joined).toContain('MEDIA_STORAGE_BUCKET');
    expect(joined).toContain('MEDIA_STORAGE_ACCESS_KEY');
    expect(joined).toContain('MEDIA_STORAGE_SECRET_KEY');
  });

  it('accepts a complete s3 configuration', () => {
    const result = loadConfig({
      ...validEnv,
      MEDIA_STORAGE_DRIVER: 's3',
      MEDIA_STORAGE_REGION: 'us-east-1',
      MEDIA_STORAGE_BUCKET: 'bucket',
      MEDIA_STORAGE_ACCESS_KEY: 'key',
      MEDIA_STORAGE_SECRET_KEY: 'secret',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects zero, negative, and absurd MEDIA_MAX_IMAGE_BYTES', () => {
    expect(loadConfig({ ...validEnv, MEDIA_MAX_IMAGE_BYTES: '0' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, MEDIA_MAX_IMAGE_BYTES: '-5' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, MEDIA_MAX_IMAGE_BYTES: String(1024 * 1024 * 1024) }).ok).toBe(
      false,
    );
  });
});

describe('loadConfig — contact notification', () => {
  it('allows an unset CONTACT_NOTIFICATION_DRIVER outside production', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'test' }).ok).toBe(true);
  });

  it('requires CONTACT_NOTIFICATION_DRIVER in production', () => {
    const result = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      MEDIA_STORAGE_DRIVER: 's3',
      MEDIA_STORAGE_REGION: 'us-east-1',
      MEDIA_STORAGE_BUCKET: 'bucket',
      MEDIA_STORAGE_ACCESS_KEY: 'key',
      MEDIA_STORAGE_SECRET_KEY: 'secret',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('CONTACT_NOTIFICATION_DRIVER');
  });

  it('requires SMTP fields when CONTACT_NOTIFICATION_DRIVER=smtp', () => {
    const result = loadConfig({ ...validEnv, CONTACT_NOTIFICATION_DRIVER: 'smtp' });
    expect(result.ok).toBe(false);
    const joined = result.errors.join(' ');
    expect(joined).toContain('SMTP_HOST');
    expect(joined).toContain('CONTACT_NOTIFICATION_TO');
  });

  it('rejects an out-of-range SMTP_PORT', () => {
    const result = loadConfig({
      ...validEnv,
      CONTACT_NOTIFICATION_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.example.invalid',
      SMTP_PORT: '99999',
      SMTP_USERNAME: 'u',
      SMTP_PASSWORD: 'p',
      SMTP_FROM: 'from@example.invalid',
      CONTACT_NOTIFICATION_TO: 'to@example.invalid',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed CONTACT_NOTIFICATION_TO address', () => {
    const result = loadConfig({ ...validEnv, CONTACT_NOTIFICATION_TO: 'not-an-email' });
    expect(result.ok).toBe(false);
  });
});

describe('loadConfig — operational', () => {
  it('defaults RATE_LIMIT_MAX to 60', () => {
    expect(loadConfig(validEnv).config?.RATE_LIMIT_MAX).toBe(60);
  });

  it('rejects zero, negative, and absurd RATE_LIMIT_MAX', () => {
    expect(loadConfig({ ...validEnv, RATE_LIMIT_MAX: '0' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, RATE_LIMIT_MAX: '-1' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, RATE_LIMIT_MAX: '999999' }).ok).toBe(false);
  });

  it('accepts a raised RATE_LIMIT_MAX for CI use', () => {
    expect(loadConfig({ ...validEnv, RATE_LIMIT_MAX: '300' }).config?.RATE_LIMIT_MAX).toBe(300);
  });

  it('rejects an invalid TRUST_PROXY value', () => {
    expect(loadConfig({ ...validEnv, TRUST_PROXY: 'true' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '2' }).ok).toBe(false);
  });

  it('accepts the two supported TRUST_PROXY values', () => {
    expect(loadConfig({ ...validEnv, TRUST_PROXY: 'false' }).ok).toBe(true);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '1' }).ok).toBe(true);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(loadConfig({ ...validEnv, LOG_LEVEL: 'verbose' }).ok).toBe(false);
  });

  it('rejects a too-short HEALTH_INTERNAL_TOKEN when set', () => {
    expect(loadConfig({ ...validEnv, HEALTH_INTERNAL_TOKEN: 'short' }).ok).toBe(false);
  });

  it('rejects a negative or absurd SHUTDOWN_GRACE_PERIOD_MS', () => {
    expect(loadConfig({ ...validEnv, SHUTDOWN_GRACE_PERIOD_MS: '-1' }).ok).toBe(false);
    expect(loadConfig({ ...validEnv, SHUTDOWN_GRACE_PERIOD_MS: '999999' }).ok).toBe(false);
  });

  it('defaults RELEASE_SHA to "unknown" and SERVICE_NAME to "portfolio-api"', () => {
    const result = loadConfig(validEnv);
    expect(result.config?.RELEASE_SHA).toBe('unknown');
    expect(result.config?.SERVICE_NAME).toBe('portfolio-api');
  });
});

describe('loadConfigOrThrow', () => {
  it('returns the parsed config for a valid environment', () => {
    expect(loadConfigOrThrow(validEnv).NODE_ENV).toBe('test');
  });

  it('throws a single aggregated error listing every problem', () => {
    expect(() => loadConfigOrThrow({ ...validEnv, NODE_ENV: 'production' })).toThrow(
      /MEDIA_STORAGE_DRIVER/,
    );
  });
});

describe('loadAdminProvisioningConfig', () => {
  it('reports both fields missing', () => {
    const result = loadAdminProvisioningConfig({});
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('ADMIN_EMAIL');
    expect(result.errors.join(' ')).toContain('ADMIN_PASSWORD');
  });

  it('rejects a malformed ADMIN_EMAIL', () => {
    const result = loadAdminProvisioningConfig({
      ADMIN_EMAIL: 'not-an-email',
      ADMIN_PASSWORD: 'x',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a valid admin email and password', () => {
    const result = loadAdminProvisioningConfig({
      ADMIN_EMAIL: 'admin@example.invalid',
      ADMIN_PASSWORD: 'a-password',
    });
    expect(result.ok).toBe(true);
    expect(result.email).toBe('admin@example.invalid');
  });
});
