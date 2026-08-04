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
 * "stop and investigate", not loop forever eating admin clicks. Enforced against real
 * ContactDeliveryAttempt reservations — one row per real send, reserved before the send even
 * happens (see `reserveAttempt` below) — never against a summarized/collapsed count. See
 * docs/contact-delivery.md. */
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
   * Claims the next attempt slot for a message *before* any real send happens — a real
   * `ContactNotificationAdapter.send()` call must never occur without an already-persisted row
   * claiming its slot first, so MAX_DELIVERY_ATTEMPTS is enforced against reservations, not
   * against successfully-finalized rows (a finalize failure after a real send still consumes the
   * slot it reserved). `attemptNumber` is allocated by reading the current per-message maximum
   * and adding one, inside the same Prisma client passed in (the caller decides whether that's a
   * `$transaction` callback's `tx` or the plain client) — combined with the
   * `@@unique([contactMessageId, attemptNumber])` constraint on the table itself, a concurrent
   * allocation race becomes a loud, immediate database error instead of two attempts silently
   * sharing a number. Manual retries additionally serialize the whole claim-cap-reserve sequence
   * inside one transaction (see retryNotification), so that constraint is a backstop here, not the
   * only thing standing between two concurrent real sends.
   */
  private async reserveAttempt(
    client: Pick<PrismaClient, 'contactDeliveryAttempt'>,
    contactMessageId: string,
  ) {
    const { _max } = await client.contactDeliveryAttempt.aggregate({
      where: { contactMessageId },
      _max: { attemptNumber: true },
    });
    const attemptNumber = (_max.attemptNumber ?? 0) + 1;
    return client.contactDeliveryAttempt.create({
      data: { contactMessageId, attemptNumber, status: 'PENDING' },
      select: { id: true, attemptNumber: true },
    });
  }

  /** Records the real outcome of an already-reserved attempt. If this write itself fails, the
   * reservation is left PENDING — a real send happened and its slot stays consumed, but the
   * outcome is unknown until someone reconciles it; it is never automatically resent (see
   * submit()/retryNotification below). */
  private async finalizeAttempt(
    client: Pick<PrismaClient, 'contactDeliveryAttempt'>,
    attemptId: string,
    result: { delivered: boolean; reason?: string },
  ) {
    await client.contactDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status: result.delivered ? 'SUCCEEDED' : 'FAILED',
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
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
      let reserved: { id: string; attemptNumber: number };
      try {
        reserved = await this.reserveAttempt(this.prisma, created.id);
      } catch {
        // Could not durably claim a slot — refuse to call the real notifier for this
        // iteration (a real send must never happen without an already-persisted row claiming
        // it first) and stop the automatic loop rather than looping blind. This must never
        // surface as a 500 to the public submitter (submit()'s own contract, above: always the
        // same generic outcome; the message itself is already safely persisted).
        recordDatabaseFailure();
        break;
      }

      const result = await this.notifier.send({
        id: created.id,
        name: created.name,
        email: created.email,
        subject: created.subject,
        message: created.message,
      });
      recordContactNotification(result.delivered);

      try {
        await this.finalizeAttempt(this.prisma, reserved.id, result);
      } catch {
        // The real send already happened and its slot is durably reserved (row stays PENDING)
        // — but the outcome couldn't be persisted. Never pretend-successful, and never loop
        // again blind: a PENDING row requires reconciliation, not an automatic resend.
        recordDatabaseFailure();
        break;
      }
      if (result.delivered) break;
    }
  }

  /**
   * Admin-triggered retry for a message whose notification delivery previously failed.
   *
   * The claim (`retryClaimedAt`), the MAX_DELIVERY_ATTEMPTS cap check, and the attempt
   * reservation all happen inside one database transaction — a real send is never invoked
   * without a slot durably reserved first, and the cap is checked against real reservations
   * (not a stale pre-transaction read), so two concurrent requests can never both pass the cap
   * check or both win the claim. The claim (`UPDATE ... WHERE id = ? AND (retryClaimedAt IS NULL
   * OR retryClaimedAt < cutoff)`) is atomic — `updateMany`'s result count tells us whether *this*
   * call won it, with no read-then-write gap for a second concurrent request to land in. A
   * message stuck claimed past RETRY_CLAIM_TTL_MS (the process that took the claim crashed
   * mid-attempt) is treated as abandoned and reclaimable. If the cap check fails, the whole
   * transaction (including the claim) rolls back, so a cap-rejected request never leaves the
   * message claimed.
   */
  async retryNotification(id: string, actorId?: string) {
    const existing = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Message not found');

    const reserved = await this.prisma.$transaction(async (tx) => {
      const claimCutoff = new Date(Date.now() - RETRY_CLAIM_TTL_MS);
      const claim = await tx.contactMessage.updateMany({
        where: { id, OR: [{ retryClaimedAt: null }, { retryClaimedAt: { lt: claimCutoff } }] },
        data: { retryClaimedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException({
          code: 'RETRY_IN_PROGRESS',
          message: 'A retry is already in progress for this message.',
        });
      }

      const attemptCount = await tx.contactDeliveryAttempt.count({
        where: { contactMessageId: id },
      });
      if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        throw new ConflictException({
          code: 'RETRY_LIMIT_REACHED',
          message:
            `This message has reached the maximum of ${MAX_DELIVERY_ATTEMPTS} delivery attempts ` +
            '— investigate the notification configuration rather than retrying again.',
        });
      }

      return this.reserveAttempt(tx, id);
    });

    const result = await this.notifier.send({
      id: existing.id,
      name: existing.name,
      email: existing.email,
      subject: existing.subject,
      message: existing.message,
    });
    recordContactNotification(result.delivered);

    // Finalizing the reservation, clearing the claim, and writing the audit entry share one
    // transaction — a failure partway through (e.g. the finalize UPDATE itself fails, or the
    // message was deleted mid-send and cascaded the reservation away) rolls the claim-clear back
    // too, leaving retryClaimedAt set from the transaction above: a genuinely "documented and
    // recoverable" state — this message stays claimed, so an immediate second retry click gets
    // RETRY_IN_PROGRESS rather than sending again, and becomes reclaimable once more after
    // RETRY_CLAIM_TTL_MS, never an uncontrolled retry loop. Left to propagate, not swallowed: the
    // global ErrorEnvelopeFilter (apps/api/src/shared.ts) turns this into a real 500 for the
    // admin caller and records it via recordDatabaseFailure() itself — this must never come back
    // as a false "retried successfully" response. The real send already happened regardless
    // (recorded above via recordContactNotification and the already-persisted PENDING reservation).
    await this.prisma.$transaction(async (tx) => {
      await this.finalizeAttempt(tx, reserved.id, result);
      await tx.contactMessage.update({ where: { id }, data: { retryClaimedAt: null } });
      await tx.auditLog.create({
        data: {
          action: 'CONTACT_MESSAGE_NOTIFICATION_RETRIED',
          resource: 'ContactMessage',
          resourceId: id,
          ...(actorId ? { actorId } : {}),
          metadata: { delivered: result.delivered, attemptNumber: reserved.attemptNumber },
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
