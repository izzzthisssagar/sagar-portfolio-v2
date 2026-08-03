import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
