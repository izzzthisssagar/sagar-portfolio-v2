import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from './local-storage.adapter';

describe('LocalStorageAdapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'media-storage-'));
    adapter = new LocalStorageAdapter(root, 'https://cdn.example.com');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes and reads back the same bytes', async () => {
    await adapter.put('quarantine/abc.png', Buffer.from('hello'), 'image/png');
    expect((await adapter.get('quarantine/abc.png')).toString()).toBe('hello');
  });

  it('moves an object from quarantine to approved and removes the source', async () => {
    await adapter.put('quarantine/abc.png', Buffer.from('hello'), 'image/png');
    await adapter.move('quarantine/abc.png', 'approved/abc.png');
    expect((await adapter.get('approved/abc.png')).toString()).toBe('hello');
    await expect(adapter.get('quarantine/abc.png')).rejects.toThrow();
  });

  it('deletes an object', async () => {
    await adapter.put('quarantine/abc.png', Buffer.from('hello'), 'image/png');
    await adapter.delete('quarantine/abc.png');
    await expect(adapter.get('quarantine/abc.png')).rejects.toThrow();
  });

  it('rejects path traversal in the storage key', async () => {
    await expect(adapter.put('../../etc/passwd', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /unsafe storage key/i,
    );
  });

  it('only returns a public URL for approved keys', () => {
    expect(adapter.publicUrl('approved/abc.png')).toBe('https://cdn.example.com/approved/abc.png');
    expect(adapter.publicUrl('quarantine/abc.png')).toBeNull();
  });

  it('returns null when no public base URL is configured', () => {
    const noPublicUrl = new LocalStorageAdapter(root);
    expect(noPublicUrl.publicUrl('approved/abc.png')).toBeNull();
  });

  it('ping() reports ok when the storage root is writable, creating it if missing', async () => {
    const nested = new LocalStorageAdapter(join(root, 'not-yet-created'));
    expect(await nested.ping()).toEqual({ ok: true });
  });

  it('ping() reports failure when the storage root cannot be created (parent path is a file)', async () => {
    await adapter.put('blocking-file', Buffer.from('x'), 'text/plain');
    const blocked = new LocalStorageAdapter(join(root, 'blocking-file', 'nested'));
    const result = await blocked.ping();
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
  });

  it('exists() reports true for a written key and false otherwise', async () => {
    await adapter.put('quarantine/abc.png', Buffer.from('hello'), 'image/png');
    expect(await adapter.exists('quarantine/abc.png')).toBe(true);
    expect(await adapter.exists('quarantine/nope.png')).toBe(false);
  });

  it('list() enumerates every object across nested prefixes with forward-slash keys', async () => {
    await adapter.put('quarantine/a.png', Buffer.from('a'), 'image/png');
    await adapter.put('approved/b.png', Buffer.from('b'), 'image/png');
    await adapter.put('archived/deep/c.png', Buffer.from('c'), 'image/png');
    const keys = (await adapter.list()).sort();
    expect(keys).toEqual(['approved/b.png', 'archived/deep/c.png', 'quarantine/a.png']);
  });

  it('list() returns an empty array for a storage root that does not exist yet', async () => {
    const empty = new LocalStorageAdapter(join(root, 'not-yet-created'));
    expect(await empty.list()).toEqual([]);
  });
});
