import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CvService } from './cv.service';

const media = {
  id: 'media1',
  category: 'DOCUMENT',
  status: 'APPROVED',
};

const doc = {
  id: 'cv1',
  mediaId: 'media1',
  title: 'CV v1',
  versionNote: null,
  active: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  media,
};

function setup() {
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    cvDocument: {
      create: vi.fn().mockResolvedValue(doc),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({ ...doc, active: true }),
      delete: vi.fn().mockResolvedValue(doc),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    mediaAsset: { findUnique: vi.fn().mockResolvedValue(media) },
    cvDocument: {
      findMany: vi.fn().mockResolvedValue([doc]),
      findUnique: vi.fn().mockResolvedValue(doc),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn((value: unknown) =>
      typeof value === 'function' ? (value as (client: unknown) => unknown)(tx) : value,
    ),
  };
  return { service: new CvService(prisma as never), prisma, tx, auditCreate };
}

describe('CvService', () => {
  it('refuses to create a CV from an unapproved or non-document media asset', async () => {
    const { service, prisma } = setup();
    prisma.mediaAsset.findUnique.mockResolvedValueOnce({ ...media, status: 'QUARANTINED' });
    await expect(service.create({ mediaId: 'media1', title: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('activates and audits', async () => {
    const { service, tx, auditCreate } = setup();
    await service.activate('cv1', 'admin1');
    expect(tx.cvDocument.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(tx.cvDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cv1' }, data: { active: true } }),
    );
    expect(auditCreate.mock.calls[0]![0].data.action).toBe('CV_ACTIVATED');
  });

  it('maps a unique-constraint violation on activation (concurrent activation) to HTTP 409', async () => {
    const { service, tx } = setup();
    tx.cvDocument.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.9.1',
      }),
    );
    await expect(service.activate('cv1', 'admin1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 404 for an unknown CV document', async () => {
    const { service, prisma } = setup();
    prisma.cvDocument.findUnique.mockResolvedValueOnce(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to delete the active CV', async () => {
    const { service, prisma } = setup();
    prisma.cvDocument.findUnique.mockResolvedValueOnce({ ...doc, active: true });
    await expect(service.remove('cv1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('never returns a public active CV whose media has fallen out of approval', async () => {
    const { service, prisma } = setup();
    prisma.cvDocument.findFirst.mockResolvedValueOnce({
      ...doc,
      active: true,
      media: { ...media, status: 'ARCHIVED' },
    });
    expect(await service.getActivePublic()).toBeNull();
  });
});
