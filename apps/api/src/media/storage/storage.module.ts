import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { MEDIA_STORAGE, type MediaStorageAdapter } from './storage-adapter.interface';

const REQUIRED_S3_VARS = [
  'MEDIA_STORAGE_REGION',
  'MEDIA_STORAGE_BUCKET',
  'MEDIA_STORAGE_ACCESS_KEY',
  'MEDIA_STORAGE_SECRET_KEY',
] as const;

function buildS3Adapter(): S3StorageAdapter {
  const missing = REQUIRED_S3_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `MEDIA_STORAGE_DRIVER=s3 requires ${missing.join(', ')} — refusing to start with ` +
        'incomplete storage configuration.',
    );
  }
  return new S3StorageAdapter({
    region: process.env.MEDIA_STORAGE_REGION!,
    bucket: process.env.MEDIA_STORAGE_BUCKET!,
    accessKeyId: process.env.MEDIA_STORAGE_ACCESS_KEY!,
    secretAccessKey: process.env.MEDIA_STORAGE_SECRET_KEY!,
    ...(process.env.MEDIA_STORAGE_ENDPOINT ? { endpoint: process.env.MEDIA_STORAGE_ENDPOINT } : {}),
    ...(process.env.MEDIA_STORAGE_PUBLIC_BASE_URL
      ? { publicBaseUrl: process.env.MEDIA_STORAGE_PUBLIC_BASE_URL }
      : {}),
  });
}

/** Never inferred from `NODE_ENV` beyond the fail-closed guard below — an explicit
 * `MEDIA_STORAGE_DRIVER` is always required to select `s3`; production additionally refuses to
 * silently default to local disk when the driver is unset. */
export function buildMediaStorageAdapter(): MediaStorageAdapter {
  const driver = process.env.MEDIA_STORAGE_DRIVER;
  if (driver === 's3') return buildS3Adapter();
  if (driver && driver !== 'local') {
    throw new Error(`Unknown MEDIA_STORAGE_DRIVER: "${driver}" (expected "local" or "s3").`);
  }
  if (!driver && process.env.NODE_ENV === 'production') {
    throw new Error(
      'MEDIA_STORAGE_DRIVER must be explicitly set to "s3" in production — refusing to fall ' +
        'back to local disk storage.',
    );
  }
  const root = process.env.MEDIA_STORAGE_LOCAL_PATH ?? join(process.cwd(), '.data', 'media');
  return new LocalStorageAdapter(root, process.env.MEDIA_STORAGE_PUBLIC_BASE_URL);
}

@Module({
  providers: [{ provide: MEDIA_STORAGE, useFactory: buildMediaStorageAdapter }],
  exports: [MEDIA_STORAGE],
})
export class StorageModule {}
