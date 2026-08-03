import { afterEach, describe, expect, it } from 'vitest';
import { CaptureNotificationAdapter } from './capture-notification.adapter';
import { buildNotificationAdapter } from './notification.module';
import { SmtpNotificationAdapter } from './smtp-notification.adapter';

const ENV_KEYS = [
  'CONTACT_NOTIFICATION_DRIVER',
  'NODE_ENV',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'CONTACT_NOTIFICATION_TO',
] as const;

describe('buildNotificationAdapter', () => {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('defaults to the capture adapter outside production', () => {
    delete process.env.CONTACT_NOTIFICATION_DRIVER;
    process.env.NODE_ENV = 'test';
    expect(buildNotificationAdapter()).toBeInstanceOf(CaptureNotificationAdapter);
  });

  it('fails closed when no driver is set in production', () => {
    delete process.env.CONTACT_NOTIFICATION_DRIVER;
    process.env.NODE_ENV = 'production';
    expect(() => buildNotificationAdapter()).toThrow(
      /refusing to fall back to the capture adapter/i,
    );
  });

  it('rejects an unknown driver value', () => {
    process.env.CONTACT_NOTIFICATION_DRIVER = 'carrier-pigeon';
    expect(() => buildNotificationAdapter()).toThrow(/unknown contact_notification_driver/i);
  });

  it('fails closed when the smtp driver is missing required configuration', () => {
    process.env.CONTACT_NOTIFICATION_DRIVER = 'smtp';
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    delete process.env.CONTACT_NOTIFICATION_TO;
    expect(() => buildNotificationAdapter()).toThrow(/requires/i);
  });

  it('builds an SMTP adapter once fully configured', () => {
    process.env.CONTACT_NOTIFICATION_DRIVER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.invalid';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USERNAME = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'noreply@example.invalid';
    process.env.CONTACT_NOTIFICATION_TO = 'owner@example.invalid';
    expect(buildNotificationAdapter()).toBeInstanceOf(SmtpNotificationAdapter);
  });
});

describe('CaptureNotificationAdapter', () => {
  it('records every send without contacting a real server', async () => {
    const adapter = new CaptureNotificationAdapter();
    const result = await adapter.send({
      id: 'm1',
      name: 'Jane',
      email: 'jane@example.invalid',
      subject: null,
      message: 'Hello',
    });
    expect(result).toEqual({ delivered: true });
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]!.id).toBe('m1');
  });
});
