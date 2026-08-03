import { describe, expect, it, vi } from 'vitest';
import { ContactService } from './contact.service';

const baseMessage = {
  id: 'msg1',
  name: 'Jane Doe',
  email: 'jane@example.invalid',
  subject: 'Hello',
  company: null,
  message: 'A question about your work.',
  status: 'NEW',
  consentAt: new Date(),
  createdAt: new Date(),
  ipHash: null,
};

function setup(adapterOverrides: Partial<{ send: ReturnType<typeof vi.fn> }> = {}) {
  const auditCreate = vi.fn().mockResolvedValue({});
  const deliveryCreate = vi.fn().mockResolvedValue({});
  const tx = {
    contactMessage: {
      update: vi.fn().mockResolvedValue({ ...baseMessage, status: 'READ' }),
      delete: vi.fn().mockResolvedValue(baseMessage),
    },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    contactMessage: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([baseMessage]),
      findUnique: vi.fn().mockResolvedValue(baseMessage),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue(baseMessage),
    },
    contactDeliveryAttempt: { create: deliveryCreate },
    $transaction: vi.fn((value: unknown) =>
      typeof value === 'function'
        ? (value as (client: unknown) => unknown)(tx)
        : Promise.all(value as Promise<unknown>[]),
    ),
  };
  const notifier = { send: vi.fn().mockResolvedValue({ delivered: true }), ...adapterOverrides };
  return {
    service: new ContactService(prisma as never, notifier as never),
    prisma,
    tx,
    auditCreate,
    deliveryCreate,
    notifier,
  };
}

describe('ContactService.submit', () => {
  it('persists a genuine submission and records a successful delivery attempt', async () => {
    const { service, prisma, notifier, deliveryCreate } = setup();
    await service.submit(
      { name: ' Jane Doe ', email: ' Jane@Example.invalid ', message: 'A question.' },
      'iphash123',
    );
    expect(prisma.contactMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Jane Doe',
          email: 'jane@example.invalid',
          ipHash: 'iphash123',
        }),
      }),
    );
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: true }) }),
    );
  });

  it('accepts silently and never persists when the honeypot is filled', async () => {
    const { service, prisma, notifier } = setup();
    await service.submit({
      name: 'Bot',
      email: 'bot@example.invalid',
      message: 'spam',
      website: 'http://spam.example',
    });
    expect(prisma.contactMessage.create).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('collapses an identical resubmission within the duplicate window instead of creating a second row', async () => {
    const { service, prisma } = setup();
    prisma.contactMessage.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Same message.' });
    expect(prisma.contactMessage.create).not.toHaveBeenCalled();
  });

  it('retries delivery up to the bound and records the final outcome, without losing the message', async () => {
    const { service, prisma, notifier, deliveryCreate } = setup({
      send: vi.fn().mockResolvedValue({ delivered: false, reason: 'SMTP timeout' }),
    });
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Hello.' });
    expect(prisma.contactMessage.create).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, reason: 'SMTP timeout' }),
      }),
    );
  });

  it('stops retrying once delivery succeeds', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ delivered: false, reason: 'transient' })
      .mockResolvedValueOnce({ delivered: true });
    const { service, notifier } = setup({ send });
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Hello.' });
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });
});

describe('ContactService admin operations', () => {
  it('lists with status/search filters', async () => {
    const { service, prisma } = setup();
    const result = await service.list({ page: 1, limit: 20 });
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(prisma.contactMessage.findMany).toHaveBeenCalled();
  });

  it('updates status and audits the change', async () => {
    const { service, tx, auditCreate } = setup();
    await service.updateStatus('msg1', 'read', 'admin1');
    expect(tx.contactMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'READ' } }),
    );
    expect(auditCreate.mock.calls[0]![0].data.action).toBe('CONTACT_MESSAGE_STATUS_CHANGED');
  });

  it('deletes and audits', async () => {
    const { service, tx, auditCreate } = setup();
    await service.remove('msg1', 'admin1');
    expect(tx.contactMessage.delete).toHaveBeenCalledWith({ where: { id: 'msg1' } });
    expect(auditCreate.mock.calls[0]![0].data.action).toBe('CONTACT_MESSAGE_DELETED');
  });
});
