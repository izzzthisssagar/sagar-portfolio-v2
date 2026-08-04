import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SmtpNotificationAdapter, type SmtpConfig } from './smtp-notification.adapter';

/**
 * Exercises SmtpNotificationAdapter over the real SMTP protocol against Mailpit — never mocks
 * nodemailer or the network. Gated on MAILPIT_API_URL the same way the MinIO suite
 * (s3-storage.adapter.integration.test.ts) gates on MEDIA_STORAGE_ENDPOINT: skipped when no
 * Mailpit instance is configured locally, required in CI (see .github/workflows/ci.yml).
 *
 * This proves the SMTP *protocol* works against Mailpit — it is not, and must never be described
 * as, verification against a real production mail provider. See docs/contact-delivery.md.
 */
const mailpitApiUrl = process.env.MAILPIT_API_URL;
const mailpitSuite = mailpitApiUrl ? describe : describe.skip;

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
  From: { Address: string };
  ReplyTo: Array<{ Address: string }>;
  Subject: string;
}

interface MailpitMessage extends MailpitMessageSummary {
  Text: string;
}

mailpitSuite('SmtpNotificationAdapter against Mailpit', () => {
  const apiUrl = (mailpitApiUrl ?? '').replace(/\/$/, '');
  const config: SmtpConfig = {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    username: process.env.SMTP_USERNAME ?? 'mailpit',
    password: process.env.SMTP_PASSWORD ?? 'mailpit',
    from: 'noreply@example.invalid',
    to: 'owner@example.invalid',
  };

  async function deleteAllMessages(): Promise<void> {
    await fetch(`${apiUrl}/api/v1/messages`, { method: 'DELETE' });
  }

  async function latestMessage(): Promise<MailpitMessage> {
    const listResponse = await fetch(`${apiUrl}/api/v1/messages`);
    const list = (await listResponse.json()) as { messages: MailpitMessageSummary[] };
    expect(list.messages.length).toBeGreaterThan(0);
    const id = list.messages[0]!.ID;
    const messageResponse = await fetch(`${apiUrl}/api/v1/message/${id}`);
    return (await messageResponse.json()) as MailpitMessage;
  }

  beforeAll(async () => {
    await deleteAllMessages();
  });

  afterEach(async () => {
    await deleteAllMessages();
  });

  it('confirms Mailpit is reachable before the suite runs', async () => {
    const response = await fetch(`${apiUrl}/api/v1/messages`);
    expect(response.ok).toBe(true);
  });

  it('accepts a message and Mailpit captures it with the intended recipient and a safe subject', async () => {
    const adapter = new SmtpNotificationAdapter(config);
    const result = await adapter.send({
      id: 'msg-1',
      name: 'Ada Lovelace',
      email: 'ada@example.invalid',
      subject: 'Collaboration inquiry',
      message: 'Would love to discuss a QA automation project.',
    });

    expect(result).toEqual({ delivered: true });

    const message = await latestMessage();
    expect(message.To.map((t) => t.Address)).toContain(config.to);
    expect(message.From.Address).toBe(config.from);
    expect(message.Subject).toBe('Portfolio contact: Collaboration inquiry');
  });

  it('sets Reply-To to the visitor email, never the configured from address', async () => {
    const adapter = new SmtpNotificationAdapter(config);
    await adapter.send({
      id: 'msg-2',
      name: 'Grace Hopper',
      email: 'grace@example.invalid',
      subject: null,
      message: 'Question about your testing case study.',
    });

    const message = await latestMessage();
    expect(message.ReplyTo.map((r) => r.Address)).toEqual(['grace@example.invalid']);
    expect(message.Subject).toBe('Portfolio contact: New message');
  });

  it('delivers the body as plain text, never rendering HTML from visitor input', async () => {
    const adapter = new SmtpNotificationAdapter(config);
    const injected = '<script>alert(1)</script> and <b>bold</b> claims';
    await adapter.send({
      id: 'msg-3',
      name: 'Test Visitor',
      email: 'visitor@example.invalid',
      subject: 'HTML test',
      message: injected,
    });

    const message = await latestMessage();
    // Present as literal text in the captured plain-text body — never stripped, executed, or
    // otherwise transformed, since the adapter never builds an HTML body at all.
    expect(message.Text).toContain(injected);
  });

  it('round-trips Unicode content correctly', async () => {
    const adapter = new SmtpNotificationAdapter(config);
    const unicodeMessage = 'Grüße 你好 こんにちは — testing QA en français, with emoji 🎯';
    await adapter.send({
      id: 'msg-4',
      name: 'Ünïcödé Nâme',
      email: 'unicode@example.invalid',
      subject: 'Ünïcödé subject 测试',
      message: unicodeMessage,
    });

    const message = await latestMessage();
    expect(message.Subject).toBe('Portfolio contact: Ünïcödé subject 测试');
    expect(message.Text).toContain(unicodeMessage);
    expect(message.Text).toContain('Ünïcödé Nâme');
  });

  it('includes name, email, subject, and message body in the plain-text content', async () => {
    const adapter = new SmtpNotificationAdapter(config);
    await adapter.send({
      id: 'msg-5',
      name: 'Full Body Check',
      email: 'fullbody@example.invalid',
      subject: 'Structure check',
      message: 'The actual inquiry text.',
    });

    const message = await latestMessage();
    expect(message.Text).toContain('Name: Full Body Check');
    expect(message.Text).toContain('Email: fullbody@example.invalid');
    expect(message.Text).toContain('Subject: Structure check');
    expect(message.Text).toContain('The actual inquiry text.');
  });

  it('reports delivered: false with a reason (never throws) when the SMTP host is unreachable', async () => {
    const adapter = new SmtpNotificationAdapter({
      ...config,
      host: '127.0.0.1',
      port: 1, // nothing listens here
    });
    const result = await adapter.send({
      id: 'msg-6',
      name: 'Unreachable Test',
      email: 'unreachable@example.invalid',
      subject: null,
      message: 'Should fail cleanly.',
    });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 15_000);

  it('reports delivered: false with a reason when connecting to a non-SMTP port (protocol/timeout failure)', async () => {
    const adapter = new SmtpNotificationAdapter({
      ...config,
      host: apiUrl.replace(/^https?:\/\//, '').split(':')[0]!,
      port: 8025, // Mailpit's HTTP API port, not SMTP — connects but never speaks SMTP
    });
    const result = await adapter.send({
      id: 'msg-7',
      name: 'Wrong Port Test',
      email: 'wrongport@example.invalid',
      subject: null,
      message: 'Should fail cleanly, not hang.',
    });
    expect(result.delivered).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 15_000);

  it('never leaks the SMTP password in a failure reason', async () => {
    const adapter = new SmtpNotificationAdapter({ ...config, host: '127.0.0.1', port: 1 });
    const result = await adapter.send({
      id: 'msg-8',
      name: 'Leak Check',
      email: 'leak@example.invalid',
      subject: null,
      message: 'x',
    });
    expect(result.reason ?? '').not.toContain(config.password);
  }, 15_000);
});
