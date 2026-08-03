import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ContactStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ContactStatusInput, ListContactMessagesDto, SubmitContactDto } from './contact.dto';
import {
  CONTACT_NOTIFICATION_ADAPTER,
  type ContactNotificationAdapter,
} from './notification/notification-adapter.interface';

const statusToDb = (status: string) => status.toUpperCase() as ContactStatus;
const messageView = <T extends { status: ContactStatus }>(row: T) => ({
  ...row,
  status: row.status.toLowerCase(),
});

/** A short window in which an identical resubmission (same normalized email + message text)
 * collapses into the original instead of creating a duplicate row — guards against an
 * accidental double click, not a hard uniqueness constraint. */
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 2;

/** Total delivery attempts (the original submit-time attempt plus every manual retry) a single
 * message may accumulate before the retry endpoint refuses further attempts — a persistent
 * configuration failure (e.g. a dead SMTP relay) must surface as "stop and investigate", not loop
 * forever eating admin clicks. See docs/contact-delivery.md. */
const MAX_DELIVERY_ATTEMPTS = 5;

/** How long a retry claim (ContactMessage.retryClaimedAt) is honored before it's treated as
 * abandoned — e.g. the process crashed mid-attempt — and becomes reclaimable. Matches
 * DUPLICATE_WINDOW_MS's order of magnitude; there's no real-world reason a single notification
 * send should take anywhere near this long. */
const RETRY_CLAIM_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONTACT_NOTIFICATION_ADAPTER) private readonly notifier: ContactNotificationAdapter,
  ) {}

  /**
   * Always resolves to the same generic outcome regardless of what happened internally (honeypot
   * tripped, duplicate collapsed, or a genuine new message) — a caller must not be able to
   * distinguish "silently dropped" from "accepted" by probing response differences. Persistence
   * happens before any notification attempt, and a message is never lost merely because delivery
   * failed (see docs/contact-delivery.md).
   */
  async submit(input: SubmitContactDto, ipHash?: string): Promise<void> {
    if (input.website?.trim()) return; // honeypot tripped — accepted, never stored

    const email = input.email.trim().toLowerCase();
    const message = input.message.trim();

    const duplicate = await this.prisma.contactMessage.findFirst({
      where: { email, message, createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      select: { id: true },
    });
    if (duplicate) return;

    const created = await this.prisma.contactMessage.create({
      data: {
        name: input.name.trim(),
        email,
        message,
        status: ContactStatus.NEW,
        consentAt: new Date(),
        ...(input.subject ? { subject: input.subject.trim() } : {}),
        ...(input.company ? { company: input.company.trim() } : {}),
        ...(ipHash ? { ipHash } : {}),
      },
    });

    let lastResult: { delivered: boolean; reason?: string } = { delivered: false };
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      lastResult = await this.notifier.send({
        id: created.id,
        name: created.name,
        email: created.email,
        subject: created.subject,
        message: created.message,
      });
      if (lastResult.delivered) break;
    }
    await this.prisma.contactDeliveryAttempt.create({
      data: {
        contactMessageId: created.id,
        success: lastResult.delivered,
        ...(lastResult.reason ? { reason: lastResult.reason } : {}),
      },
    });
  }

  /**
   * Admin-triggered retry for a message whose notification delivery previously failed.
   *
   * The claim (`retryClaimedAt`) is taken with a single atomic conditional `UPDATE ... WHERE id
   * = ? AND (retryClaimedAt IS NULL OR retryClaimedAt < cutoff)` — `updateMany`'s result count
   * tells us whether *this* call won the claim, with no read-then-write gap for a second
   * concurrent request to land in. A message stuck claimed past RETRY_CLAIM_TTL_MS (the process
   * that took the claim crashed mid-attempt) is treated as abandoned and reclaimable.
   */
  async retryNotification(id: string, actorId?: string) {
    const existing = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: { deliveryAttempts: true },
    });
    if (!existing) throw new NotFoundException('Message not found');

    if (existing.deliveryAttempts.length >= MAX_DELIVERY_ATTEMPTS) {
      throw new ConflictException({
        code: 'RETRY_LIMIT_REACHED',
        message:
          `This message has reached the maximum of ${MAX_DELIVERY_ATTEMPTS} delivery attempts — ` +
          'investigate the notification configuration rather than retrying again.',
      });
    }

    const claimCutoff = new Date(Date.now() - RETRY_CLAIM_TTL_MS);
    const claim = await this.prisma.contactMessage.updateMany({
      where: { id, OR: [{ retryClaimedAt: null }, { retryClaimedAt: { lt: claimCutoff } }] },
      data: { retryClaimedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException({
        code: 'RETRY_IN_PROGRESS',
        message: 'A retry is already in progress for this message.',
      });
    }

    const result = await this.notifier.send({
      id: existing.id,
      name: existing.name,
      email: existing.email,
      subject: existing.subject,
      message: existing.message,
    });

    await this.prisma.$transaction([
      this.prisma.contactDeliveryAttempt.create({
        data: {
          contactMessageId: id,
          success: result.delivered,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      }),
      // Clears the claim regardless of outcome — a failed retry must remain retryable (up to
      // MAX_DELIVERY_ATTEMPTS), not get stuck permanently claimed.
      this.prisma.contactMessage.update({ where: { id }, data: { retryClaimedAt: null } }),
      this.prisma.auditLog.create({
        data: {
          action: 'CONTACT_MESSAGE_NOTIFICATION_RETRIED',
          resource: 'ContactMessage',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { delivered: result.delivered },
        },
      }),
    ]);

    return this.get(id);
  }

  async list(query: ListContactMessagesDto) {
    const where: Prisma.ContactMessageWhereInput = {
      ...(query.status ? { status: statusToDb(query.status) } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { deliveryAttempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return { data: data.map(messageView), meta: { page: query.page, limit: query.limit, total } };
  }

  async get(id: string) {
    const row = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: { deliveryAttempts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!row) throw new NotFoundException('Message not found');
    return messageView(row);
  }

  async updateStatus(id: string, status: ContactStatusInput, actorId?: string) {
    await this.get(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contactMessage.update({
        where: { id },
        data: { status: statusToDb(status) },
      });
      await tx.auditLog.create({
        data: {
          action: 'CONTACT_MESSAGE_STATUS_CHANGED',
          resource: 'ContactMessage',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { status },
        },
      });
      return row;
    });
    return messageView(updated);
  }

  async remove(id: string, actorId?: string) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.contactMessage.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          action: 'CONTACT_MESSAGE_DELETED',
          resource: 'ContactMessage',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
        },
      });
    });
  }
}
