import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from './memory-storage.adapter';

describe('MemoryStorageAdapter', () => {
  it('writes, reads, moves, and deletes', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('quarantine/a', Buffer.from('x'), 'image/png');
    expect((await adapter.get('quarantine/a')).toString()).toBe('x');
    await adapter.move('quarantine/a', 'approved/a');
    expect((await adapter.get('approved/a')).toString()).toBe('x');
    await expect(adapter.get('quarantine/a')).rejects.toThrow();
    await adapter.delete('approved/a');
    await expect(adapter.get('approved/a')).rejects.toThrow();
  });

  it('only returns a public URL for approved keys', () => {
    const adapter = new MemoryStorageAdapter();
    expect(adapter.publicUrl('approved/a')).toBe('memory://approved/a');
    expect(adapter.publicUrl('quarantine/a')).toBeNull();
  });

  it('ping() always reports ok', async () => {
    expect(await new MemoryStorageAdapter().ping()).toEqual({ ok: true });
  });
});
