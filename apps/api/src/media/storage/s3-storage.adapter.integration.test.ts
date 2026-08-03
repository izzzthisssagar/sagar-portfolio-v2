import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { S3StorageAdapter } from './s3-storage.adapter';

/**
 * Exercises S3StorageAdapter over the real S3 protocol against MinIO — never mocks the AWS SDK.
 * Gated on MEDIA_STORAGE_ENDPOINT the same way DB-backed suites gate on DATABASE_URL (see
 * apps/api/test/health.api.integration.test.ts): skipped when no MinIO endpoint is configured
 * locally, required in CI (see .github/workflows/ci.yml).
 *
 * This proves the S3-compatible *protocol* works against MinIO — it is not, and must never be
 * described as, verification against real AWS S3. See docs/media-pipeline.md.
 */
const endpoint = process.env.MEDIA_STORAGE_ENDPOINT;
const minioSuite = endpoint ? describe : describe.skip;

minioSuite('S3StorageAdapter against MinIO', () => {
  const bucket = process.env.MEDIA_STORAGE_BUCKET ?? 'portfolio-media-test';
  // `exactOptionalPropertyTypes` treats `{ endpoint: undefined }` differently from omitting the
  // key — this suite only ever runs (minioSuite gates on it) when `endpoint` is truthy, but the
  // config object is still constructed once, eagerly, even inside a skipped `describe.skip` body.
  const endpointValue: string = endpoint ?? '';
  const config = {
    region: process.env.MEDIA_STORAGE_REGION ?? 'us-east-1',
    bucket,
    accessKeyId: process.env.MEDIA_STORAGE_ACCESS_KEY ?? '',
    secretAccessKey: process.env.MEDIA_STORAGE_SECRET_KEY ?? '',
    endpoint: endpointValue,
    publicBaseUrl: 'http://localhost:4000/media',
  };
  const adapter = new S3StorageAdapter(config);
  // A second client, independent of the adapter under test, used only to assert ground truth
  // (exact bytes/content-type as MinIO actually stored them, not as the adapter claims).
  const rawClient = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    endpoint: endpointValue,
    forcePathStyle: true,
  });
  const testPrefix = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const writtenKeys: string[] = [];

  async function put(key: string, body: Buffer, contentType: string) {
    writtenKeys.push(key);
    await adapter.put(key, body, contentType);
  }

  afterAll(async () => {
    await Promise.all(
      writtenKeys.map((key) =>
        rawClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {}),
      ),
    );
  });

  it('confirms the bucket exists and is reachable', async () => {
    await expect(rawClient.send(new HeadBucketCommand({ Bucket: bucket }))).resolves.toBeDefined();
  });

  it('ping() reports ok against a real reachable bucket', async () => {
    expect(await adapter.ping()).toEqual({ ok: true });
  });

  it('writes an object and reads back the exact same bytes', async () => {
    const key = `${testPrefix}/quarantine/roundtrip.png`;
    const body = Buffer.from('the quick brown fox jumps over the lazy dog — media bytes');
    await put(key, body, 'image/png');
    const readBack = await adapter.get(key);
    expect(readBack.equals(body)).toBe(true);
  });

  it('stores the exact content-type given, verified independently of the adapter', async () => {
    const key = `${testPrefix}/quarantine/content-type.pdf`;
    await put(key, Buffer.from('%PDF-1.4 fake'), 'application/pdf');
    const raw = await rawClient.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    expect(raw.ContentType).toBe('application/pdf');
  });

  it('moves an object from quarantine to approved — copy then delete of the source', async () => {
    const fromKey = `${testPrefix}/quarantine/move-me.png`;
    const toKey = `${testPrefix}/approved/move-me.png`;
    writtenKeys.push(toKey);
    const body = Buffer.from('moveable bytes');
    await put(fromKey, body, 'image/png');

    await adapter.move(fromKey, toKey);

    expect((await adapter.get(toKey)).equals(body)).toBe(true);
    await expect(adapter.get(fromKey)).rejects.toThrow();
  });

  it('moves approved -> archived exactly the same way (the real quarantine->approved->archived lifecycle)', async () => {
    const quarantineKey = `${testPrefix}/quarantine/lifecycle.png`;
    const approvedKey = `${testPrefix}/approved/lifecycle.png`;
    const archivedKey = `${testPrefix}/archived/lifecycle.png`;
    writtenKeys.push(approvedKey, archivedKey);
    const body = Buffer.from('lifecycle bytes');
    await put(quarantineKey, body, 'image/png');

    await adapter.move(quarantineKey, approvedKey);
    expect((await adapter.get(approvedKey)).equals(body)).toBe(true);

    await adapter.move(approvedKey, archivedKey);
    expect((await adapter.get(archivedKey)).equals(body)).toBe(true);
    await expect(adapter.get(approvedKey)).rejects.toThrow();
  });

  it('deletes an object', async () => {
    const key = `${testPrefix}/quarantine/delete-me.png`;
    await put(key, Buffer.from('doomed bytes'), 'image/png');
    await adapter.delete(key);
    await expect(adapter.get(key)).rejects.toThrow();

    const listing = await rawClient.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: key }),
    );
    expect(listing.Contents ?? []).toHaveLength(0);
  });

  it('only returns a public URL for approved/ keys, never quarantine/archived/trash', async () => {
    // Real keys carry the status prefix first (`approved/<hash>.png`), not nested under a test
    // prefix — matches storage-adapter.interface.ts's documented key convention.
    expect(adapter.publicUrl('approved/x.png')).toBe('http://localhost:4000/media/approved/x.png');
    expect(adapter.publicUrl('quarantine/x.png')).toBeNull();
    expect(adapter.publicUrl('archived/x.png')).toBeNull();
    expect(adapter.publicUrl('trash/x.png')).toBeNull();
  });

  it('rejects reading an object that was never written', async () => {
    await expect(adapter.get(`${testPrefix}/quarantine/never-existed.png`)).rejects.toThrow();
  });

  it('ping() reports failure (not a throw) against a nonexistent bucket', async () => {
    const badAdapter = new S3StorageAdapter({ ...config, bucket: 'this-bucket-does-not-exist' });
    const result = await badAdapter.ping();
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
    // Never leaks endpoint/credential detail into the readiness-facing result.
    expect(result.detail).not.toContain(config.accessKeyId);
    expect(result.detail).not.toContain(endpoint);
  });

  it('ping() reports failure (not a throw) against an unreachable endpoint', async () => {
    const badAdapter = new S3StorageAdapter({
      ...config,
      endpoint: 'http://127.0.0.1:1', // nothing listens here
    });
    const result = await badAdapter.ping();
    expect(result.ok).toBe(false);
  }, 15_000);

  it('rejects with a real error (not a silent success) on bad credentials', async () => {
    const badAdapter = new S3StorageAdapter({ ...config, secretAccessKey: 'wrong-secret-key' });
    await expect(
      badAdapter.put(`${testPrefix}/quarantine/should-fail.png`, Buffer.from('x'), 'image/png'),
    ).rejects.toThrow();
  });
});
