'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type AdminContactMessage, messages } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

export function ContactRowActions({ message }: { message: AdminContactMessage }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
      <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)}>
        DELETE
      </button>
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
