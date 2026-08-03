'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, posts, type AdminPost } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

const NEXT_TRANSITION: Partial<
  Record<
    AdminPost['status'],
    { transition: 'draft' | 'review' | 'publish' | 'archive'; label: string }[]
  >
> = {
  draft: [
    { transition: 'review', label: 'SEND TO REVIEW' },
    { transition: 'publish', label: 'PUBLISH' },
  ],
  review: [{ transition: 'publish', label: 'PUBLISH' }],
  published: [{ transition: 'draft', label: 'UNPUBLISH' }],
  archived: [{ transition: 'draft', label: 'RESTORE TO DRAFT' }],
};

export function PostRowActions({ post }: { post: AdminPost }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function runTransition(transition: 'draft' | 'review' | 'publish' | 'archive') {
    setPending(true);
    setError(null);
    try {
      await posts.transition(post.id, transition);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, ...(Array.isArray(err.details) ? err.details : [])].join(' ')
          : 'Could not update this post.',
      );
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    setPending(true);
    try {
      await posts.remove(post.id);
      router.refresh();
    } catch {
      setError('Could not delete this post.');
    } finally {
      setPending(false);
    }
  }

  const transitions = NEXT_TRANSITION[post.status] ?? [];

  return (
    <div className="project-row-actions">
      <Link href={`/admin/posts/${post.id}`}>EDIT</Link>
      <Link href={`/admin/posts/${post.id}/preview`}>PREVIEW</Link>
      {transitions.map((t) => (
        <button
          key={t.transition}
          type="button"
          disabled={pending}
          onClick={() => runTransition(t.transition)}
        >
          {t.label}
        </button>
      ))}
      {post.status !== 'archived' && (
        <button type="button" disabled={pending} onClick={() => runTransition('archive')}>
          ARCHIVE
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)}>
        DELETE
      </button>
      {error && (
        <p role="alert" className="project-row-error">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete "${post.title}"?`}
        description="This permanently deletes the post. This cannot be undone."
        confirmLabel="DELETE"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
