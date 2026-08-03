import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service';
import { MemoryStorageAdapter } from './storage/memory-storage.adapter';

async function pngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } })
    .png()
    .toBuffer();
}

const baseMedia = {
  id: 'm1',
  filename: 'photo.png',
  storageKey: 'quarantine/abc.png',
  mimeType: 'image/png',
  extension: 'png',
  category: 'IMAGE',
  byteSize: 100,
  sha256: 'abc',
  status: 'QUARANTINED',
  altText: null,
  decorative: false,
  caption: null,
  sourceNote: null,
  rejectionReason: null,
  width: 4,
  height: 4,
  durationMs: null,
  metadata: null,
  createdById: null,
  approvedAt: null,
  rejectedAt: null,
  createdAt: new Date(),
};

function setup() {
  const storage = new MemoryStorageAdapter();
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    mediaAsset: {
      create: vi.fn().mockResolvedValue(baseMedia),
      update: vi.fn().mockResolvedValue({ ...baseMedia, status: 'APPROVED' }),
      delete: vi.fn().mockResolvedValue(baseMedia),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    mediaAsset: {
      findUnique: vi.fn().mockResolvedValue(baseMedia),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([baseMedia]),
      count: vi.fn().mockResolvedValue(1),
    },
    $transaction: vi.fn((value: unknown) =>
      typeof value === 'function'
        ? (value as (client: unknown) => unknown)(tx)
        : Promise.all(value as Promise<unknown>[]),
    ),
  };
  return { service: new MediaService(prisma as never, storage), prisma, tx, auditCreate, storage };
}

describe('MediaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists and paginates', async () => {
    const { service, prisma } = setup();
    const result = await service.list({ page: 1, limit: 20 });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(prisma.mediaAsset.findMany).toHaveBeenCalled();
  });

  it('uploads a valid image: validates, re-encodes, stores under quarantine, and audits', async () => {
    const { service, tx, auditCreate, storage } = setup();
    const buffer = await pngBuffer();
    await service.upload({ buffer, originalname: 'photo.png', mimetype: 'image/png' }, 'admin1');
    expect(tx.mediaAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUARANTINED',
          category: 'IMAGE',
          createdById: 'admin1',
        }),
      }),
    );
    expect(auditCreate.mock.calls[0]![0].data.action).toBe('MEDIA_UPLOADED');
    expect(storage.objects.size).toBe(1);
    const [key] = [...storage.objects.keys()];
    expect(key).toMatch(/^quarantine\//);
  });

  it('rejects an upload that fails validation with a 400', async () => {
    const { service } = setup();
    await expect(
      service.upload(
        { buffer: Buffer.from('not an image'), originalname: 'photo.png', mimetype: 'image/png' },
        'admin1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('short-circuits on a duplicate checksum instead of storing twice', async () => {
    const { service, prisma, storage } = setup();
    prisma.mediaAsset.findFirst.mockResolvedValueOnce(baseMedia);
    const buffer = await pngBuffer();
    const result = await service.upload({
      buffer,
      originalname: 'photo.png',
      mimetype: 'image/png',
    });
    expect(result.id).toBe('m1');
    expect(storage.objects.size).toBe(0);
  });

  it('refuses to approve a content-bearing image with no alt text and not marked decorative', async () => {
    const { service, storage } = setup();
    await storage.put('quarantine/abc.png', Buffer.from('x'), 'image/png');
    await expect(service.approve('m1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves once alt text is supplied, moving the object to approved/', async () => {
    const { service, storage, tx } = setup();
    await storage.put('quarantine/abc.png', Buffer.from('x'), 'image/png');
    await service.approve('m1', { altText: 'A decorative shape.' }, 'admin1');
    expect(tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', storageKey: 'approved/abc.png' }),
      }),
    );
    expect(storage.objects.has('approved/abc.png')).toBe(true);
    expect(storage.objects.has('quarantine/abc.png')).toBe(false);
  });

  it('approves a decorative image with no alt text', async () => {
    const { service, storage } = setup();
    await storage.put('quarantine/abc.png', Buffer.from('x'), 'image/png');
    await expect(service.approve('m1', { decorative: true })).resolves.toBeDefined();
  });

  it('refuses to approve media that is not quarantined', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({ ...baseMedia, status: 'APPROVED' });
    await expect(service.approve('m1', { altText: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects quarantined media with a reason, leaving the file in quarantine', async () => {
    const { service, storage, tx } = setup();
    await storage.put('quarantine/abc.png', Buffer.from('x'), 'image/png');
    await service.reject('m1', { reason: 'Not evidence-relevant.' }, 'admin1');
    expect(tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          rejectionReason: 'Not evidence-relevant.',
        }),
      }),
    );
    expect(storage.objects.has('quarantine/abc.png')).toBe(true);
  });

  it('archives approved media, moving it out of approved/', async () => {
    const { service, prisma, storage, tx } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValue({
      ...baseMedia,
      status: 'APPROVED',
      storageKey: 'approved/abc.png',
    });
    await storage.put('approved/abc.png', Buffer.from('x'), 'image/png');
    await service.archive('m1', 'admin1');
    expect(tx.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ARCHIVED' }) }),
    );
    expect(storage.publicUrl('archived/abc.png')).toBeNull();
  });

  it('refuses to archive media that is not approved', async () => {
    const { service } = setup();
    await expect(service.archive('m1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks deletion of media still attached to a project or post', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({
      ...baseMedia,
      projects: [{ id: 'pm1' }],
      socialFor: [],
      featuredFor: [],
      portraitFor: [],
      cvDocument: null,
    });
    await expect(service.remove('m1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks deletion of the active portrait', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({
      ...baseMedia,
      projects: [],
      socialFor: [],
      featuredFor: [],
      portraitFor: [{ id: 'profile1' }],
      cvDocument: null,
    });
    await expect(service.remove('m1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks deletion of media referenced by a CV document', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({
      ...baseMedia,
      projects: [],
      socialFor: [],
      featuredFor: [],
      portraitFor: [],
      cvDocument: { id: 'cv1' },
    });
    await expect(service.remove('m1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes an unattached asset from storage and the database', async () => {
    const { service, prisma, storage, tx } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({
      ...baseMedia,
      projects: [],
      socialFor: [],
      featuredFor: [],
      portraitFor: [],
      cvDocument: null,
    });
    await storage.put('quarantine/abc.png', Buffer.from('x'), 'image/png');
    await service.remove('m1', 'admin1');
    expect(storage.objects.has('quarantine/abc.png')).toBe(false);
    expect(tx.mediaAsset.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('throws 404 for an unknown id', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves an approved asset publicly with its sha256 for cache validation', async () => {
    const { service, prisma, storage } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({ ...baseMedia, status: 'APPROVED' });
    await storage.put('quarantine/abc.png', Buffer.from('bytes'), 'image/png');
    const result = await service.getApprovedFile('m1');
    expect(result).toEqual({
      buffer: Buffer.from('bytes'),
      mimeType: 'image/png',
      filename: 'photo.png',
      sha256: 'abc',
    });
  });

  it('returns null for a public file request against a non-approved asset, without distinguishing why', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({ ...baseMedia, status: 'QUARANTINED' });
    expect(await service.getApprovedFile('m1')).toBeNull();
  });

  it('returns null for a public file request against an approved document (PDF)', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({
      ...baseMedia,
      status: 'APPROVED',
      category: 'DOCUMENT',
    });
    expect(await service.getApprovedFile('m1')).toBeNull();
  });

  describe('update() alt-text invariant on approved images', () => {
    const approvedImage = { ...baseMedia, status: 'APPROVED', altText: 'Existing alt text.' };

    it('rejects clearing alt text on an approved, non-decorative image', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue(approvedImage);
      await expect(service.update('m1', { altText: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.update('m1', { altText: '   ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects marking non-decorative with no alt text supplied and none already stored', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        ...approvedImage,
        altText: null,
        decorative: true,
      });
      await expect(service.update('m1', { decorative: false })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows marking an approved image decorative even with no alt text', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue({ ...approvedImage, altText: null });
      await expect(service.update('m1', { decorative: true })).resolves.toBeDefined();
    });

    it('allows an unrelated field edit that keeps the existing alt text intact', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue(approvedImage);
      await expect(service.update('m1', { caption: 'New caption' })).resolves.toBeDefined();
    });

    it('does not apply the invariant to a still-quarantined image', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue({ ...baseMedia, status: 'QUARANTINED' });
      await expect(service.update('m1', { altText: '' })).resolves.toBeDefined();
    });

    it('does not apply the invariant to a document', async () => {
      const { service, prisma } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        ...approvedImage,
        category: 'DOCUMENT',
        altText: null,
      });
      await expect(service.update('m1', { decorative: false })).resolves.toBeDefined();
    });
  });

  describe('storage/database compensation (fault injection)', () => {
    it('upload: deletes the quarantine object if the database transaction fails', async () => {
      const { service, tx, storage } = setup();
      tx.mediaAsset.create.mockRejectedValueOnce(new Error('db down'));
      const buffer = await pngBuffer();
      await expect(
        service.upload({ buffer, originalname: 'photo.png', mimetype: 'image/png' }),
      ).rejects.toThrow('db down');
      expect(storage.objects.size).toBe(0);
    });

    it('approve: restores the quarantine object if the database transaction fails', async () => {
      const { service, tx, storage } = setup();
      await storage.put('quarantine/abc.png', Buffer.from('bytes'), 'image/png');
      tx.mediaAsset.update.mockRejectedValueOnce(new Error('db down'));
      await expect(service.approve('m1', { decorative: true })).rejects.toThrow('db down');
      expect(storage.objects.has('quarantine/abc.png')).toBe(true);
      expect(storage.objects.has('approved/abc.png')).toBe(false);
    });

    it('archive: restores the approved object if the database transaction fails', async () => {
      const { service, prisma, tx, storage } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValue({
        ...baseMedia,
        status: 'APPROVED',
        storageKey: 'approved/abc.png',
      });
      await storage.put('approved/abc.png', Buffer.from('bytes'), 'image/png');
      tx.mediaAsset.update.mockRejectedValueOnce(new Error('db down'));
      await expect(service.archive('m1')).rejects.toThrow('db down');
      expect(storage.objects.has('approved/abc.png')).toBe(true);
      expect(storage.objects.has('archived/abc.png')).toBe(false);
    });

    it('remove: restores the object to its original key if the database transaction fails, leaving no row pointing at a missing object', async () => {
      const { service, prisma, tx, storage } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValueOnce({
        ...baseMedia,
        projects: [],
        socialFor: [],
        featuredFor: [],
        portraitFor: [],
        cvDocument: null,
      });
      await storage.put('quarantine/abc.png', Buffer.from('bytes'), 'image/png');
      tx.mediaAsset.delete.mockRejectedValueOnce(new Error('db down'));
      await expect(service.remove('m1')).rejects.toThrow('db down');
      // The row (per the mock) still exists and still points at the original key — the object
      // must be back there, not stuck in trash, and not deleted outright.
      expect(storage.objects.has('quarantine/abc.png')).toBe(true);
      expect(storage.objects.size).toBe(1);
    });

    it('remove: never touches the database if moving to trash fails, leaving the object exactly where it was', async () => {
      const { service, prisma, tx, storage } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValueOnce({
        ...baseMedia,
        projects: [],
        socialFor: [],
        featuredFor: [],
        portraitFor: [],
        cvDocument: null,
      });
      await storage.put('quarantine/abc.png', Buffer.from('bytes'), 'image/png');
      vi.spyOn(storage, 'move').mockRejectedValueOnce(new Error('storage unavailable'));
      await expect(service.remove('m1')).rejects.toThrow('storage unavailable');
      expect(storage.objects.has('quarantine/abc.png')).toBe(true);
      expect(tx.mediaAsset.delete).not.toHaveBeenCalled();
    });

    it('remove: deletes the trash object once the database transaction succeeds, leaving no orphan', async () => {
      const { service, prisma, storage } = setup();
      prisma.mediaAsset.findUnique.mockResolvedValueOnce({
        ...baseMedia,
        projects: [],
        socialFor: [],
        featuredFor: [],
        portraitFor: [],
        cvDocument: null,
      });
      await storage.put('quarantine/abc.png', Buffer.from('bytes'), 'image/png');
      await service.remove('m1');
      expect(storage.objects.size).toBe(0);
    });
  });
});
