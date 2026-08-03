import type {
  ContactMessageSummary,
  ContactNotificationAdapter,
  NotificationResult,
} from './notification-adapter.interface';

/**
 * Development/test adapter — records the attempt without contacting any real mail server, so CI
 * and local dev can assert delivery bookkeeping without a live SMTP dependency. Never logs the
 * message body or personal data (see docs/contact-delivery.md), only that a send was attempted.
 */
export class CaptureNotificationAdapter implements ContactNotificationAdapter {
  readonly sent: ContactMessageSummary[] = [];

  async send(message: ContactMessageSummary): Promise<NotificationResult> {
    this.sent.push(message);
    return { delivered: true };
  }
}
