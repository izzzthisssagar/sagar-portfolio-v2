import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ContactService, MAX_DELIVERY_ATTEMPTS } from '../src/contact/contact.service';
import {
  CONTACT_NOTIFICATION_ADAPTER,
  type ContactMessageSummary,
  type ContactNotificationAdapter,
  type NotificationResult,
} from '../src/contact/notification/notification-adapter.interface';
import { PrismaService } from '../src/prisma/prisma.service';

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;

/** A fully controllable fake — real Postgres underneath (the real ContactService/PrismaService DI
 * graph, real AppModule bootstrap), but the notification transport itself is scripted per test:
 * exactly which send() calls succeed/fail, in what order, how many actually happened, and
 * (for scenario F) an async hook that runs real Prisma writes of its own before send() resolves.
 * This is what makes "first send fails, second succeeds", "both fail", and "concurrent retries"
 * deterministic rather than dependent on a real SMTP relay's timing. */
class ScriptedNotificationAdapter implements ContactNotificationAdapter {
  calls: ContactMessageSummary[] = [];
  private script: NotificationResult[] = [];
  private fallback: NotificationResult = { delivered: true };
  private delayMs = 0;
  onSend: (() => void | Promise<void>) | undefined = undefined;

  setScript(results: NotificationResult[]) {
    this.script = [...results];
  }
  setFallback(result: NotificationResult) {
    this.fallback = result;
  }
  /** Artificial delay before send() resolves — real SMTP round trips are never instant, but this
   * fake normally is, which would close the real in-flight window a genuine concurrency test
   * needs before a second call can reliably land inside it (see scenario E below). */
  setDelayMs(ms: number) {
    this.delayMs = ms;
  }
  reset() {
    this.calls = [];
    this.script = [];
    this.fallback = { delivered: true };
    this.delayMs = 0;
    this.onSend = undefined;
  }

  async send(message: ContactMessageSummary): Promise<NotificationResult> {
    this.calls.push(message);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const result = this.script.length > 0 ? this.script.shift()! : this.fallback;
    if (this.onSend) await this.onSend();
    return result;
  }
}

databaseSuite('Contact delivery attempts — one row per real send (real PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contactService: ContactService;
  let notifier: ScriptedNotificationAdapter;
  const testEmailPrefix = 'contact-attempts-';

  beforeAll(async () => {
    notifier = new ScriptedNotificationAdapter();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONTACT_NOTIFICATION_ADAPTER)
      .useValue(notifier)
      .compile();
    app = module.createNestApplication();
    await app.init();
    prisma = module.get(PrismaService);
    contactService = module.get(ContactService);
    await prisma.contactMessage.deleteMany({ where: { email: { startsWith: testEmailPrefix } } });
  });

  beforeEach(() => {
    notifier.reset();
  });

  afterAll(async () => {
    await prisma.contactMessage.deleteMany({ where: { email: { startsWith: testEmailPrefix } } });
    await app.close();
  });

  async function createMessage(emailLocalPart: string) {
    const email = `${testEmailPrefix}${emailLocalPart}@example.invalid`;
    await contactService.submit({
      name: 'Attempt Scenario',
      email,
      message: `Message for ${emailLocalPart}.`,
    });
    return prisma.contactMessage.findFirstOrThrow({ where: { email } });
  }

  async function attempts(contactMessageId: string) {
    return prisma.contactDeliveryAttempt.findMany({
      where: { contactMessageId },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  it('A. first send succeeds — one SMTP invocation, one attempt row numbered 1', async () => {
    notifier.setFallback({ delivered: true });
    const created = await createMessage('a-first-succeeds');

    expect(notifier.calls).toHaveLength(1);
    const rows = await attempts(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attemptNumber: 1, success: true });
  });

  it('B. first send fails, automatic retry succeeds — two invocations, attempts 1 (failed) and 2 (succeeded)', async () => {
    notifier.setScript([{ delivered: false, reason: 'SMTP timeout' }, { delivered: true }]);
    const created = await createMessage('b-fail-then-succeed');

    expect(notifier.calls).toHaveLength(2);
    const rows = await attempts(created.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attemptNumber: 1, success: false, reason: 'SMTP timeout' });
    expect(rows[1]).toMatchObject({ attemptNumber: 2, success: true });
  });

  it('C. both automatic sends fail — two failed attempt rows, numbered 1 and 2', async () => {
    notifier.setFallback({ delivered: false, reason: 'relay unreachable' });
    const created = await createMessage('c-both-fail');

    expect(notifier.calls).toHaveLength(2);
    const rows = await attempts(created.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ attemptNumber: 1, success: false });
    expect(rows[1]).toMatchObject({ attemptNumber: 2, success: false });
  });

  it('D. manual retries: each creates exactly one row, and no 6th send occurs once 5 real sends have happened', async () => {
    notifier.setFallback({ delivered: false, reason: 'still down' });
    const created = await createMessage('d-manual-retries');
    // The automatic submit-time loop already made 2 real sends (both failed, per the fallback
    // above) — 3 more manual retries reach exactly MAX_DELIVERY_ATTEMPTS (5).
    expect(notifier.calls).toHaveLength(2);

    for (let i = 0; i < 3; i += 1) {
      await contactService.retryNotification(created.id);
    }
    expect(notifier.calls).toHaveLength(5);
    const rows = await attempts(created.id);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3, 4, 5]);

    // A 6th real send must never occur — the endpoint refuses once MAX_DELIVERY_ATTEMPTS is hit.
    await expect(contactService.retryNotification(created.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RETRY_LIMIT_REACHED' }),
    });
    expect(notifier.calls).toHaveLength(5);
    expect(await attempts(created.id)).toHaveLength(MAX_DELIVERY_ATTEMPTS);
  });

  it('E. two concurrent manual retry requests: one wins, one SMTP invocation, one attempt allocated, the loser gets RETRY_IN_PROGRESS', async () => {
    notifier.setFallback({ delivered: true });
    const created = await createMessage('e-concurrent-retries');
    expect(notifier.calls).toHaveLength(1); // the automatic submit-time send, already succeeded

    notifier.reset();
    notifier.setFallback({ delivered: true });
    // Keeps the claim-holding call genuinely "in flight" long enough for the second concurrent
    // call's own claim attempt to run and fail against it — without this, this fake's near-instant
    // resolution would let the first call finish (and clear its claim) before the second call's
    // updateMany ever executes, so both would legitimately succeed one after the other instead of
    // actually racing (see contact.api.integration.test.ts's atomic-claim test for the same
    // reasoning applied directly at the query level).
    notifier.setDelayMs(50);
    const results = await Promise.allSettled([
      contactService.retryNotification(created.id),
      contactService.retryNotification(created.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      response: expect.objectContaining({ code: 'RETRY_IN_PROGRESS' }),
    });

    // Exactly one real send happened for the retry itself.
    expect(notifier.calls).toHaveLength(1);
    // Exactly one new attempt row was allocated (attemptNumber 2 — 1 already existed from
    // submit()), never two, never a duplicate/overwritten number.
    const rows = await attempts(created.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2]);
  });

  it('F. a failed attempt-recording write is never reported as success, and never leaves a phantom attempt row', async () => {
    const created = await createMessage('f-db-write-fails');
    expect(notifier.calls).toHaveLength(1); // the real submit-time send

    notifier.reset();
    notifier.setFallback({ delivered: true });
    // Simulates an admin concurrently deleting the message while this retry's SMTP send is still
    // in flight — a genuine foreign-key violation on the attempt-row INSERT that follows, not a
    // simulated/mocked Prisma failure. ContactDeliveryAttempt.contactMessageId has
    // onDelete: Cascade, so the pre-existing attempt #1 row is also genuinely gone once this
    // fires — a real, observable consequence of the message no longer existing, not a bug in
    // this test.
    notifier.onSend = async () => {
      await prisma.contactMessage.delete({ where: { id: created.id } });
    };

    await expect(contactService.retryNotification(created.id)).rejects.toThrow();

    // The real send genuinely happened — never falsely un-reported.
    expect(notifier.calls).toHaveLength(1);
    // But nothing about it is durably, falsely recorded as a success: the whole transaction
    // (attempt-row insert + claim-clear + audit) rolled back when the FK constraint failed. The
    // resulting state is honestly inspectable (an admin investigating sees the message is simply
    // gone, not a phantom "attempt 2" row pointing at nothing) — a documented, recoverable state,
    // not a silently-swallowed lie or an uncontrolled retry loop (there is nothing left to retry).
    expect(await prisma.contactMessage.findUnique({ where: { id: created.id } })).toBeNull();
    expect(
      await prisma.contactDeliveryAttempt.findMany({ where: { contactMessageId: created.id } }),
    ).toHaveLength(0);
  });

  it('never records more real ContactDeliveryAttempt rows than real notifier.send() invocations, across a mixed automatic+manual sequence', async () => {
    notifier.setScript([
      { delivered: false, reason: 'first' },
      { delivered: false, reason: 'second' },
    ]);
    const created = await createMessage('mixed-sequence-integrity');
    notifier.setFallback({ delivered: false, reason: 'still failing' });
    await contactService.retryNotification(created.id);
    notifier.setFallback({ delivered: true });
    await contactService.retryNotification(created.id);

    const rows = await attempts(created.id);
    expect(rows).toHaveLength(notifier.calls.length);
    expect(rows.map((r) => r.attemptNumber)).toEqual(
      Array.from({ length: notifier.calls.length }, (_, i) => i + 1),
    );
    expect(rows.at(-1)?.success).toBe(true);
  });
});
