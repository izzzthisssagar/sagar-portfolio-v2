export interface ContactMessageSummary {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
}

export interface NotificationResult {
  delivered: boolean;
  reason?: string;
}

export interface ContactNotificationAdapter {
  send(message: ContactMessageSummary): Promise<NotificationResult>;
}

export const CONTACT_NOTIFICATION_ADAPTER = Symbol('CONTACT_NOTIFICATION_ADAPTER');
