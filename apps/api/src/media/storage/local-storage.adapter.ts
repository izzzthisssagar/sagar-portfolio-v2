import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { MediaStorageAdapter } from './storage-adapter.interface';

/** Rejects any key that would escape `root` after normalization — the only defense actually
 * needed against path traversal, since keys are always content-addressed (never a raw filename)
 * and this is checked regardless. */
function assertSafeKey(key: string): void {
  const normalized = normalize(key);
  if (
    normalized.startsWith('..') ||
    normalized.includes(`..${sep}`) ||
    normalized.startsWith('/')
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export class LocalStorageAdapter implements MediaStorageAdapter {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl?: string,
  ) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const from = this.resolve(fromKey);
    const to = this.resolve(toKey);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl || !key.startsWith('approved/')) return null;
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root, constants.W_OK);
      return { ok: true };
    } catch {
      return { ok: false, detail: 'storage root is not accessible' };
    }
  }
}
