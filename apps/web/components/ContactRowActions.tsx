'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, type AdminContactMessage, messages } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

export function ContactRowActions({ message }: { message: AdminContactMessage }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Latest attempt first (deliveryAttempts is ordered createdAt desc — see ContactService.get/list).
  const lastAttempt = message.deliveryAttempts?.[0];
  // retryExhausted is explicit from the API (see AdminContactMessage) — never re-derived from
  // deliveryAttempts.length here, since the list view's own array is deliberately truncated to
  // the latest one attempt and would under-count.
  const canRetry =
    lastAttempt !== undefined && lastAttempt.status === 'FAILED' && !message.retryExhausted;

  async function setStatus(status: AdminContactMessage['status']) {
    setPending(true);
    try {
      await messages.updateStatus(message.id, status);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    setPending(true);
    try {
      await messages.remove(message.id);
      router.push('/admin/messages');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleRetry() {
    setConfirmingRetry(false);
    setPending(true);
    setRetryError(null);
    try {
      await messages.retryNotification(message.id);
      router.refresh();
    } catch (err) {
      setRetryError(err instanceof ApiError ? err.message : 'Retry failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="project-row-actions">
      <Link href={`/admin/messages/${message.id}`}>VIEW</Link>
      {message.status === 'new' && (
        <button type="button" disabled={pending} onClick={() => setStatus('read')}>
          MARK READ
        </button>
      )}
      {message.status !== 'replied' && (
        <button type="button" disabled={pending} onClick={() => setStatus('replied')}>
          MARK REPLIED
        </button>
      )}
      {message.status !== 'archived' && (
        <button type="button" disabled={pending} onClick={() => setStatus('archived')}>
          ARCHIVE
        </button>
      )}
      {message.status !== 'spam' && (
        <button type="button" disabled={pending} onClick={() => setStatus('spam')}>
          SPAM
        </button>
      )}
      {canRetry && (
        <button type="button" disabled={pending} onClick={() => setConfirmingRetry(true)}>
          RETRY NOTIFICATION
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)}>
        DELETE
      </button>
      {retryError && (
        <p role="alert" className="field-error">
          {retryError}
        </p>
      )}
      <ConfirmDialog
        open={confirmingRetry}
        title="Retry the notification for this message?"
        description="Attempts delivery again through the configured notification channel."
        confirmLabel="RETRY"
        onConfirm={handleRetry}
        onCancel={() => setConfirmingRetry(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete the message from "${message.name}"?`}
        description="This permanently deletes the message. This cannot be undone."
        confirmLabel="DELETE"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
