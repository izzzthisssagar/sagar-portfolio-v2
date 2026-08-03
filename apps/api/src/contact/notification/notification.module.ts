import { Module } from '@nestjs/common';
import { CaptureNotificationAdapter } from './capture-notification.adapter';
import { CONTACT_NOTIFICATION_ADAPTER } from './notification-adapter.interface';
import { SmtpNotificationAdapter } from './smtp-notification.adapter';

const REQUIRED_SMTP_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'CONTACT_NOTIFICATION_TO',
] as const;

function buildSmtpAdapter(): SmtpNotificationAdapter {
  const missing = REQUIRED_SMTP_VARS.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `CONTACT_NOTIFICATION_DRIVER=smtp requires ${missing.join(', ')} — refusing to start ` +
        'with incomplete notification configuration.',
    );
  }
  return new SmtpNotificationAdapter({
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    username: process.env.SMTP_USERNAME!,
    password: process.env.SMTP_PASSWORD!,
    from: process.env.SMTP_FROM!,
    to: process.env.CONTACT_NOTIFICATION_TO!,
  });
}

/** Never inferred from `NODE_ENV` beyond the fail-closed guard below — mirrors
 * `buildMediaStorageAdapter`'s policy exactly (see storage.module.ts). */
export function buildNotificationAdapter() {
  const driver = process.env.CONTACT_NOTIFICATION_DRIVER;
  if (driver === 'smtp') return buildSmtpAdapter();
  if (driver && driver !== 'capture') {
    throw new Error(
      `Unknown CONTACT_NOTIFICATION_DRIVER: "${driver}" (expected "capture" or "smtp").`,
    );
  }
  if (!driver && process.env.NODE_ENV === 'production') {
    throw new Error(
      'CONTACT_NOTIFICATION_DRIVER must be explicitly set to "smtp" in production — refusing to ' +
        'fall back to the capture adapter.',
    );
  }
  return new CaptureNotificationAdapter();
}

@Module({
  providers: [{ provide: CONTACT_NOTIFICATION_ADAPTER, useFactory: buildNotificationAdapter }],
  exports: [CONTACT_NOTIFICATION_ADAPTER],
})
export class NotificationModule {}
