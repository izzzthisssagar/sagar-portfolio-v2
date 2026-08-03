import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { maxBytesFor, storageKey, validateUpload } from './media-validation';

async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer();
}

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'latin1',
);
const ENCRYPTED_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R/Encrypt 2 0 R>>\n%%EOF',
  'latin1',
);
const SVG_BUFFER = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
const SCRIPT_DISGUISED_AS_PNG = Buffer.from('<script>alert(1)</script>', 'utf8');

describe('validateUpload', () => {
  afterEach(() => {
    delete process.env.MEDIA_MAX_IMAGE_BYTES;
    delete process.env.MEDIA_MAX_PDF_BYTES;
  });

  it('accepts a real PNG regardless of the declared Content-Type', async () => {
    const result = await validateUpload(await pngBuffer(), 'photo.png', 'application/octet-stream');
    expect(result).toEqual({
      ok: true,
      file: {
        category: 'IMAGE',
        mimeType: 'image/png',
        extension: 'png',
        sha256: expect.any(String),
      },
    });
  });

  it('accepts jpg/jpeg extension aliasing without flagging a mismatch', async () => {
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00f' } })
      .jpeg()
      .toBuffer();
    const result = await validateUpload(jpeg, 'photo.jpeg', 'image/jpeg');
    expect(result.ok).toBe(true);
  });

  it('accepts a minimal PDF', async () => {
    const result = await validateUpload(MINIMAL_PDF, 'evidence.pdf', 'application/pdf');
    expect(result).toEqual({
      ok: true,
      file: {
        category: 'DOCUMENT',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sha256: expect.any(String),
      },
    });
  });

  it('rejects SVG outright, regardless of extension or declared type', async () => {
    const result = await validateUpload(SVG_BUFFER, 'icon.svg', 'image/svg+xml');
    expect(result.ok).toBe(false);
  });

  it('rejects content whose bytes are not a recognized file type at all', async () => {
    const result = await validateUpload(SCRIPT_DISGUISED_AS_PNG, 'photo.png', 'image/png');
    expect(result).toEqual({ ok: false, reason: 'UNRECOGNIZED_FILE_TYPE' });
  });

  it('rejects when the claimed extension disagrees with the detected file type', async () => {
    const result = await validateUpload(await pngBuffer(), 'photo.pdf', 'application/pdf');
    expect(result).toEqual({ ok: false, reason: 'EXTENSION_MISMATCH' });
  });

  it('rejects a PDF that declares an /Encrypt dictionary', async () => {
    const result = await validateUpload(ENCRYPTED_PDF, 'evidence.pdf', 'application/pdf');
    expect(result).toEqual({ ok: false, reason: 'ENCRYPTED_PDF' });
  });

  it('rejects an oversize upload against the configured limit', async () => {
    process.env.MEDIA_MAX_IMAGE_BYTES = '10';
    const result = await validateUpload(await pngBuffer(), 'photo.png', 'image/png');
    expect(result).toEqual({ ok: false, reason: 'OVERSIZE' });
  });
});

describe('maxBytesFor', () => {
  afterEach(() => {
    delete process.env.MEDIA_MAX_IMAGE_BYTES;
    delete process.env.MEDIA_MAX_PDF_BYTES;
  });

  it('falls back to a sane default when unset or invalid', () => {
    expect(maxBytesFor('IMAGE')).toBeGreaterThan(0);
    process.env.MEDIA_MAX_IMAGE_BYTES = 'not-a-number';
    expect(maxBytesFor('IMAGE')).toBeGreaterThan(0);
  });

  it('honors a configured override', () => {
    process.env.MEDIA_MAX_PDF_BYTES = '12345';
    expect(maxBytesFor('DOCUMENT')).toBe(12345);
  });
});

describe('storageKey', () => {
  it('is content-addressed and prefix-scoped', () => {
    expect(storageKey('quarantine', 'abc123', 'png')).toBe('quarantine/abc123.png');
    expect(storageKey('approved', 'abc123', 'pdf')).toBe('approved/abc123.pdf');
  });
});
