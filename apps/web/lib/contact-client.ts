'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ContactSubmitError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ContactSubmission {
  name: string;
  email: string;
  subject?: string;
  company?: string;
  message: string;
  /** Honeypot — always sent empty by the real form; a filled value only ever comes from a bot
   * that populates every field it finds. */
  website?: string;
}

/**
 * No admin session/refresh logic here (unlike admin-api.client) — this is a public,
 * unauthenticated endpoint that never 401s, so none of that machinery applies. The response
 * shape is always the same generic `{ received: true }` regardless of what happened server-side
 * (see docs/contact-delivery.md) — this never exposes delivery-provider details because the API
 * never sends any.
 */
export async function submitContact(input: ContactSubmission): Promise<void> {
  const response = await fetch(`${API_URL}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = payload?.error as { code?: string; message?: string; details?: unknown } | undefined;
    throw new ContactSubmitError(
      response.status,
      error?.message ?? 'Could not send your message. Try again.',
      error?.details,
    );
  }
}
