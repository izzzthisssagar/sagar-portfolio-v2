/**
 * Storage keys are content-addressed (derived from the upload's SHA-256 checksum) and always
 * carry a `quarantine/` or `approved/` prefix — never a user-supplied filename, and never a bare
 * key an approval/rejection could accidentally leave ambiguous about visibility. See
 * `docs/media-pipeline.md`.
 */
export interface MediaStorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Used by approve (quarantine -> approved) and archive (approved -> archived) transitions —
   * a single move keeps the object available under exactly one key at a time instead of briefly
   * existing at both the old and new location. */
  move(fromKey: string, toKey: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Null when the key isn't publicly addressable (no public base URL configured, or the key
   * isn't under `approved/`) — callers must treat null as "not servable", not fall back to
   * guessing a URL. */
  publicUrl(key: string): string | null;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');
