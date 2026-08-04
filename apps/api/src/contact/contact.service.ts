import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ContactStatus, Prisma, type PrismaClient } from '@prisma/client';
import { recordContactNotification, recordDatabaseFailure } from '../metrics/registry';
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

/** Total real ContactNotificationAdapter.send() invocations (the automatic sends `submit()` makes
 * plus every manual retry) a single message may accumulate before the retry endpoint refuses
 * further attempts — a persistent configuration failure (e.g. a dead SMTP relay) must surface as
 * "stop and investigate", not loop forever eating admin clicks. Enforced against the real
 * ContactDeliveryAttempt row count — one row per real send, always (see `recordAttempt` below) —
 * never against a summarized/collapsed count. See docs/contact-delivery.md. */
export const MAX_DELIVERY_ATTEMPTS = 5;

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
   * Records exactly one real `ContactNotificationAdapter.send()` outcome as its own row — every
   * call site below calls this once per real send, never once per message. `attemptNumber` is
   * allocated by reading the current per-message maximum and adding one, inside the same Prisma
   * client passed in (the caller decides whether that's a `$transaction` callback's `tx` or the
   * plain client) — combined with the `@@unique([contactMessageId, attemptNumber])` constraint on
   * the table itself, a concurrent allocation race becomes a loud, immediate database error
   * instead of two attempts silently sharing a number (or one silently overwriting the other).
   * Manual retries are additionally serialized at the application level by
   * `ContactMessage.retryClaimedAt` before this is ever called, so that constraint is a backstop
   * here, not the only thing standing between two concurrent real sends.
   */
  private async recordAttempt(
    client: Pick<PrismaClient, 'contactDeliveryAttempt'>,
    contactMessageId: string,
    result: { delivered: boolean; reason?: string },
  ) {
    const { _max } = await client.contactDeliveryAttempt.aggregate({
      where: { contactMessageId },
      _max: { attemptNumber: true },
    });
    const attemptNumber = (_max.attemptNumber ?? 0) + 1;
    const attempt = await client.contactDeliveryAttempt.create({
      data: {
        contactMessageId,
        attemptNumber,
        success: result.delivered,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
    return attempt;
  }

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

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      const result = await this.notifier.send({
        id: created.id,
        name: created.name,
        email: created.email,
        subject: created.subject,
        message: created.message,
      });
      recordContactNotification(result.delivered);
      try {
        await this.recordAttempt(this.prisma, created.id, result);
      } catch {
        // The real SMTP send already happened regardless of whether it could be durably
        // recorded — this must never surface as a 500 to the public submitter (submit()'s own
        // contract, above: always the same generic outcome; the message itself is already
        // safely persisted). It must also never be silently pretended-successful: this is the
        // same signal apps/api/src/shared.ts's global ErrorEnvelopeFilter would emit had this
        // exception propagated to the HTTP boundary instead of being caught here.
        recordDatabaseFailure();
      }
      if (result.delivered) break;
    }
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
    recordContactNotification(result.delivered);

    // A single real send, recorded as exactly one attempt row — allocating the attempt number
    // and clearing the claim inside the same transaction as the row's creation means a failure
    // partway through (e.g. the attempt-row INSERT itself fails) rolls the claim-clear back too,
    // leaving retryClaimedAt set from the updateMany above: a genuinely "documented and
    // recoverable" state — this message stays claimed, so an immediate second retry click gets
    // RETRY_IN_PROGRESS rather than sending again, and becomes reclaimable once more after
    // RETRY_CLAIM_TTL_MS, never an uncontrolled retry loop. Left to propagate, not swallowed: the
    // global ErrorEnvelopeFilter (apps/api/src/shared.ts) turns this into a real 500 for the
    // admin caller and records it via recordDatabaseFailure() itself — this must never come back
    // as a false "retried successfully" response.
    await this.prisma.$transaction(async (tx) => {
      const attempt = await this.recordAttempt(tx, id, result);
      await tx.contactMessage.update({ where: { id }, data: { retryClaimedAt: null } });
      await tx.auditLog.create({
        data: {
          action: 'CONTACT_MESSAGE_NOTIFICATION_RETRIED',
          resource: 'ContactMessage',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { delivered: result.delivered, attemptNumber: attempt.attemptNumber },
        },
      });
    });

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
        include: {
          deliveryAttempts: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { deliveryAttempts: true } },
        },
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return {
      // retryExhausted is explicit, not left for the CMS to infer from array length: the list
      // view's own `deliveryAttempts` array is deliberately truncated to the latest one (a full
      // history is only fetched by get()), so `_count` — never included in the response itself —
      // is the only accurate source for "has this message hit MAX_DELIVERY_ATTEMPTS real sends".
      data: data.map(({ _count, ...row }) => ({
        ...messageView(row),
        retryExhausted: _count.deliveryAttempts >= MAX_DELIVERY_ATTEMPTS,
      })),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async get(id: string) {
    const row = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: { deliveryAttempts: { orderBy: { createdAt: 'desc' } } },
    });
    if (!row) throw new NotFoundException('Message not found');
    return {
      ...messageView(row),
      retryExhausted: row.deliveryAttempts.length >= MAX_DELIVERY_ATTEMPTS,
    };
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
