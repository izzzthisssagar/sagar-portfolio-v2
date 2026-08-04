import type { MediaStorageAdapter } from './storage-adapter.interface';

/** In-memory fake, unit tests only — never selected by `MEDIA_STORAGE_DRIVER`. */
export class MemoryStorageAdapter implements MediaStorageAdapter {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (!value) throw new Error(`No object at key: ${key}`);
    return value;
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const value = await this.get(fromKey);
    this.objects.set(toKey, value);
    this.objects.delete(fromKey);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  publicUrl(key: string): string | null {
    return key.startsWith('approved/') ? `memory://${key}` : null;
  }

  async ping(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.objects.keys());
  }
}
