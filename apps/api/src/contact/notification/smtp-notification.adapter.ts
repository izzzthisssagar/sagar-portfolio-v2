import nodemailer, { type Transporter } from 'nodemailer';
import type {
  ContactMessageSummary,
  ContactNotificationAdapter,
  NotificationResult,
} from './notification-adapter.interface';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string;
}

/**
 * Plain-text only, deliberately — never builds an HTML email body from admin- or
 * visitor-supplied text, which sidesteps HTML-injection entirely rather than trying to sanitize
 * it. See docs/contact-delivery.md.
 */
export class SmtpNotificationAdapter implements ContactNotificationAdapter {
  private readonly transporter: Transporter;
  private readonly config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: config.password },
    });
  }

  async send(message: ContactMessageSummary): Promise<NotificationResult> {
    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        replyTo: message.email,
        subject: `Portfolio contact: ${message.subject || 'New message'}`,
        text: [
          `Name: ${message.name}`,
          `Email: ${message.email}`,
          message.subject ? `Subject: ${message.subject}` : null,
          '',
          message.message,
        ]
          .filter((line) => line !== null)
          .join('\n'),
      });
      return { delivered: true };
    } catch (error) {
      return { delivered: false, reason: error instanceof Error ? error.message : 'SMTP error' };
    }
  }
}
