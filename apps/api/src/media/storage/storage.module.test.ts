import { afterEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { buildMediaStorageAdapter } from './storage.module';

const ENV_KEYS = [
  'MEDIA_STORAGE_DRIVER',
  'NODE_ENV',
  'MEDIA_STORAGE_REGION',
  'MEDIA_STORAGE_BUCKET',
  'MEDIA_STORAGE_ACCESS_KEY',
  'MEDIA_STORAGE_SECRET_KEY',
] as const;

describe('buildMediaStorageAdapter', () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('defaults to local storage outside production', () => {
    delete process.env.MEDIA_STORAGE_DRIVER;
    process.env.NODE_ENV = 'test';
    expect(buildMediaStorageAdapter()).toBeInstanceOf(LocalStorageAdapter);
  });

  it('fails closed when no driver is set in production', () => {
    delete process.env.MEDIA_STORAGE_DRIVER;
    process.env.NODE_ENV = 'production';
    expect(() => buildMediaStorageAdapter()).toThrow(/refusing to fall back to local disk/i);
  });

  it('rejects an unknown driver value', () => {
    process.env.MEDIA_STORAGE_DRIVER = 'ftp';
    expect(() => buildMediaStorageAdapter()).toThrow(/unknown media_storage_driver/i);
  });

  it('fails closed when the s3 driver is missing required configuration', () => {
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    delete process.env.MEDIA_STORAGE_REGION;
    delete process.env.MEDIA_STORAGE_BUCKET;
    delete process.env.MEDIA_STORAGE_ACCESS_KEY;
    delete process.env.MEDIA_STORAGE_SECRET_KEY;
    expect(() => buildMediaStorageAdapter()).toThrow(/requires/i);
  });

  it('builds an S3 adapter once fully configured', () => {
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    process.env.MEDIA_STORAGE_REGION = 'us-east-1';
    process.env.MEDIA_STORAGE_BUCKET = 'bucket';
    process.env.MEDIA_STORAGE_ACCESS_KEY = 'key';
    process.env.MEDIA_STORAGE_SECRET_KEY = 'secret';
    expect(buildMediaStorageAdapter()).toBeInstanceOf(S3StorageAdapter);
  });
});
