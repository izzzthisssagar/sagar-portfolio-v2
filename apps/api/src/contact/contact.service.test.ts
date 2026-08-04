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
  retryClaimedAt: null,
};

function setup(adapterOverrides: Partial<{ send: ReturnType<typeof vi.fn> }> = {}) {
  const auditCreate = vi.fn().mockResolvedValue({});
  // reserveAttempt() reads the current max attemptNumber, then creates a PENDING row — a fresh
  // message with no prior attempts unless a test overrides it.
  const deliveryAggregate = vi.fn().mockResolvedValue({ _max: { attemptNumber: null } });
  const deliveryCreate = vi.fn().mockResolvedValue({ id: 'attempt1', attemptNumber: 1 });
  const deliveryUpdate = vi.fn().mockResolvedValue({});
  const deliveryCount = vi.fn().mockResolvedValue(0);
  const txMessageUpdate = vi.fn().mockResolvedValue({ ...baseMessage, status: 'READ' });
  const txMessageDelete = vi.fn().mockResolvedValue(baseMessage);
  const txMessageUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  // retryNotification wraps the claim + cap-check + reservation in one $transaction, then
  // finalize + claim-clear + audit in a second — both use this same tx client in the mock.
  const tx = {
    contactMessage: {
      update: txMessageUpdate,
      delete: txMessageDelete,
      updateMany: txMessageUpdateMany,
    },
    contactDeliveryAttempt: {
      create: deliveryCreate,
      update: deliveryUpdate,
      aggregate: deliveryAggregate,
      count: deliveryCount,
    },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    contactMessage: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([{ ...baseMessage, _count: { deliveryAttempts: 0 } }]),
      findUnique: vi.fn().mockResolvedValue({ ...baseMessage, deliveryAttempts: [] }),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue(baseMessage),
    },
    contactDeliveryAttempt: {
      create: deliveryCreate,
      update: deliveryUpdate,
      aggregate: deliveryAggregate,
      count: deliveryCount,
    },
    auditLog: { create: auditCreate },
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
    deliveryUpdate,
    deliveryAggregate,
    deliveryCount,
    txMessageUpdateMany,
    notifier,
  };
}

describe('ContactService.submit', () => {
  it('reserves an attempt before sending, and finalizes it SUCCEEDED on delivery', async () => {
    const { service, prisma, notifier, deliveryCreate, deliveryUpdate } = setup();
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
    // The reservation (PENDING) happens before send() is ever called — asserted by call order,
    // not just by both eventually having been called.
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attemptNumber: 1, status: 'PENDING' }),
      }),
    );
    expect(deliveryCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      notifier.send.mock.invocationCallOrder[0]!,
    );
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
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

  it('retries delivery up to the bound and finalizes each real send as its own attempt', async () => {
    const { service, prisma, notifier, deliveryCreate, deliveryUpdate } = setup({
      send: vi.fn().mockResolvedValue({ delivered: false, reason: 'SMTP timeout' }),
    });
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Hello.' });
    expect(prisma.contactMessage.create).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledTimes(2);
    expect(deliveryCreate).toHaveBeenCalledTimes(2);
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', reason: 'SMTP timeout' }),
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

  it('never calls the notifier when the reservation itself fails to persist', async () => {
    const { service, notifier, deliveryCreate } = setup();
    deliveryCreate.mockRejectedValueOnce(new Error('database unavailable'));
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Hello.' });
    // Reservation failed on the first iteration — the automatic loop stops rather than calling
    // the real notifier with no durable slot claimed first.
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('stops the automatic loop (does not resend blind) when finalizing a real send fails', async () => {
    const { service, notifier, deliveryUpdate } = setup({
      send: vi.fn().mockResolvedValue({ delivered: false, reason: 'SMTP timeout' }),
    });
    deliveryUpdate.mockRejectedValueOnce(new Error('database unavailable'));
    await service.submit({ name: 'Jane', email: 'jane@example.invalid', message: 'Hello.' });
    // The real send happened once (its reservation is left PENDING, not resent automatically) —
    // never a second blind send within the same submission.
    expect(notifier.send).toHaveBeenCalledTimes(1);
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

describe('ContactService.retryNotification', () => {
  it('throws 404 when the message does not exist', async () => {
    const { service, prisma } = setup();
    prisma.contactMessage.findUnique.mockResolvedValueOnce(null);
    await expect(service.retryNotification('missing')).rejects.toThrow('Message not found');
  });

  it('refuses to retry once MAX_DELIVERY_ATTEMPTS is reached, and never reserves or sends', async () => {
    const { service, notifier, deliveryCreate, deliveryCount } = setup();
    // The cap check now reads the real reservation count transactionally, not a pre-transaction
    // findUnique — 5 already-reserved attempts (any status) is enough to refuse.
    deliveryCount.mockResolvedValueOnce(5);
    await expect(service.retryNotification('msg1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RETRY_LIMIT_REACHED' }),
    });
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('rejects when the atomic claim fails (a retry is already in progress), before ever reserving', async () => {
    const { service, notifier, deliveryCreate, txMessageUpdateMany } = setup();
    txMessageUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.retryNotification('msg1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RETRY_IN_PROGRESS' }),
    });
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('never calls the notifier when the reservation itself fails to persist', async () => {
    const { service, notifier, deliveryCreate } = setup();
    deliveryCreate.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.retryNotification('msg1')).rejects.toThrow('database unavailable');
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it('on a successful claim, reserves before sending, finalizes, clears the claim, and audits — even on delivery failure', async () => {
    const { service, notifier, tx, deliveryCreate, deliveryUpdate, auditCreate } = setup({
      send: vi.fn().mockResolvedValue({ delivered: false, reason: 'SMTP timeout' }),
    });
    await service.retryNotification('msg1', 'admin1');

    expect(tx.contactMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'msg1',
          OR: [{ retryClaimedAt: null }, { retryClaimedAt: { lt: expect.any(Date) } }],
        }),
        data: { retryClaimedAt: expect.any(Date) },
      }),
    );
    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contactMessageId: 'msg1',
          attemptNumber: 1,
          status: 'PENDING',
        }),
      }),
    );
    expect(deliveryCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      notifier.send.mock.invocationCallOrder[0]!,
    );
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'attempt1' },
        data: expect.objectContaining({ status: 'FAILED', reason: 'SMTP timeout' }),
      }),
    );
    expect(tx.contactMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg1' },
      data: { retryClaimedAt: null },
    });
    expect(auditCreate.mock.calls[0]![0].data).toMatchObject({
      action: 'CONTACT_MESSAGE_NOTIFICATION_RETRIED',
      resourceId: 'msg1',
      actorId: 'admin1',
      metadata: { delivered: false, attemptNumber: 1 },
    });
  });
});
