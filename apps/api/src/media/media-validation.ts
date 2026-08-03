import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** `file-type` ships ESM-only with no CommonJS entry point — this compiles to CommonJS
 * (`nest build`), so a static `import` would emit a `require()` that throws `ERR_REQUIRE_ESM` at
 * runtime. A dynamic `import()` is the standard interop for loading an ESM-only dependency from
 * CommonJS and works correctly under Node's module loader either way. */
async function fileTypeFromBuffer(buffer: Buffer) {
  const mod = await import('file-type');
  return mod.fileTypeFromBuffer(buffer);
}

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export type ValidationRejection =
  | 'UNRECOGNIZED_FILE_TYPE'
  | 'DISALLOWED_TYPE'
  | 'EXTENSION_MISMATCH'
  | 'OVERSIZE'
  | 'ENCRYPTED_PDF';

export interface ValidatedFile {
  category: 'IMAGE' | 'DOCUMENT';
  mimeType: string;
  extension: string;
  sha256: string;
}

export type ValidationResult =
  | { ok: true; file: ValidatedFile }
  | { ok: false; reason: ValidationRejection };

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PDF_BYTES = 15 * 1024 * 1024;

export function maxBytesFor(category: 'IMAGE' | 'DOCUMENT'): number {
  const env =
    category === 'IMAGE' ? process.env.MEDIA_MAX_IMAGE_BYTES : process.env.MEDIA_MAX_PDF_BYTES;
  const parsed = env ? Number(env) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return category === 'IMAGE' ? DEFAULT_MAX_IMAGE_BYTES : DEFAULT_MAX_PDF_BYTES;
}

/** Sharp/libvips build support for AVIF varies by platform — probed once, lazily, rather than
 * assumed, so an unsupported build excludes AVIF from the allowlist instead of accepting and
 * silently mangling it (see docs/media-pipeline.md). */
let avifSupportPromise: Promise<boolean> | null = null;
export function avifSupported(): Promise<boolean> {
  avifSupportPromise ??= sharp({
    create: { width: 2, height: 2, channels: 3, background: '#fff' },
  })
    .avif()
    .toBuffer()
    .then(() => true)
    .catch(() => false);
  return avifSupportPromise;
}

function extensionOf(originalFilename: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(originalFilename);
  return match ? match[1]!.toLowerCase() : null;
}

/** A crude but practical heuristic — not a full PDF parser — for the one signal that's cheap to
 * check without one: the `/Encrypt` dictionary key that every password-protected PDF's trailer
 * declares. False negatives are possible (a resilient parser would do more); false positives on
 * an unencrypted PDF that merely contains the literal bytes `/Encrypt` in a content stream are
 * vanishingly rare in real-world uploads. */
function looksEncrypted(buffer: Buffer): boolean {
  return buffer.includes('/Encrypt');
}

export async function validateUpload(
  buffer: Buffer,
  originalFilename: string,
  declaredMimeType: string,
): Promise<ValidationResult> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return { ok: false, reason: 'UNRECOGNIZED_FILE_TYPE' };

  const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(detected.mime);
  const isDocument = (DOCUMENT_MIME_TYPES as readonly string[]).includes(detected.mime);
  if (!isImage && !isDocument) return { ok: false, reason: 'DISALLOWED_TYPE' };
  if (isImage && detected.mime === 'image/avif' && !(await avifSupported())) {
    return { ok: false, reason: 'DISALLOWED_TYPE' };
  }

  // Never trust the client's declared Content-Type/filename for classification — only for a
  // consistency check against what the bytes actually are.
  void declaredMimeType;
  const claimedExtension = extensionOf(originalFilename);
  if (
    claimedExtension &&
    claimedExtension !== detected.ext &&
    !aliasMatches(claimedExtension, detected.ext)
  ) {
    return { ok: false, reason: 'EXTENSION_MISMATCH' };
  }

  const category: 'IMAGE' | 'DOCUMENT' = isImage ? 'IMAGE' : 'DOCUMENT';
  if (buffer.byteLength > maxBytesFor(category)) return { ok: false, reason: 'OVERSIZE' };
  if (isDocument && looksEncrypted(buffer)) return { ok: false, reason: 'ENCRYPTED_PDF' };

  return {
    ok: true,
    file: {
      category,
      mimeType: detected.mime,
      extension: detected.ext,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}

/** `jpg`/`jpeg` are the same format under two conventional extensions — `file-type` always
 * reports `jpg`, so a `.jpeg` upload must not be rejected as a mismatch. */
function aliasMatches(claimed: string, detected: string): boolean {
  const jpeg = new Set(['jpg', 'jpeg']);
  return jpeg.has(claimed) && jpeg.has(detected);
}

export function storageKey(
  prefix: 'quarantine' | 'approved' | 'archived' | 'trash',
  sha256: string,
  extension: string,
): string {
  return `${prefix}/${sha256}.${extension}`;
}

/** Display-only — never used to construct a filesystem or storage path (storageKey is
 * content-addressed, never derived from this). Strips any path components and anything outside
 * a conservative safe-character set, and bounds the length. */
export function normalizeFilenameForDisplay(originalFilename: string): string {
  const basename = originalFilename.split(/[/\\]/).pop() ?? 'upload';
  const cleaned = basename.replace(/[^a-zA-Z0-9 ._-]/g, '_').trim();
  return (cleaned || 'upload').slice(0, 200);
}
