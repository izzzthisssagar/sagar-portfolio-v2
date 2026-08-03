'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, type AdminMedia, media } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

export function MediaDetailForm({ item }: { item: AdminMedia }) {
  const router = useRouter();
  const [altText, setAltText] = useState(item.altText ?? '');
  const [decorative, setDecorative] = useState(item.decorative);
  const [caption, setCaption] = useState(item.caption ?? '');
  const [sourceNote, setSourceNote] = useState(item.sourceNote ?? '');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? [err.message, ...(Array.isArray(err.details) ? err.details : [])].join(' ')
          : 'That action failed.',
      );
    } finally {
      setPending(false);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(() =>
      media.update(item.id, {
        altText,
        decorative,
        caption,
        sourceNote,
      }),
    );
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    await run(async () => {
      await media.remove(item.id);
      router.push('/admin/media');
    });
  }

  return (
    <div className="media-detail">
      {error && (
        <p role="alert" className="server-error">
          {error}
        </p>
      )}

      <div className="media-detail-preview">
        {item.category === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated, non-public asset
          <img src={media.fileUrl(item.id)} alt={altText || 'No alt text set'} />
        ) : (
          <a href={media.fileUrl(item.id)} target="_blank" rel="noopener noreferrer">
            Open PDF in a new tab
          </a>
        )}
      </div>

      <dl className="media-detail-facts">
        <div>
          <dt>Status</dt>
          <dd>{item.status}</dd>
        </div>
        <div>
          <dt>MIME type</dt>
          <dd>{item.mimeType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{item.byteSize.toLocaleString()} bytes</dd>
        </div>
        {item.width && item.height && (
          <div>
            <dt>Dimensions</dt>
            <dd>
              {item.width} × {item.height}
            </dd>
          </div>
        )}
        {item.rejectionReason && (
          <div>
            <dt>Rejection reason</dt>
            <dd>{item.rejectionReason}</dd>
          </div>
        )}
      </dl>

      <form onSubmit={handleSave} className="project-form">
        <div className="field">
          <label htmlFor="field-altText">Alt text</label>
          <input
            id="field-altText"
            value={altText}
            onChange={(event) => setAltText(event.target.value)}
            disabled={decorative}
          />
        </div>
        <div className="field field--checkbox">
          <label htmlFor="field-decorative">
            <input
              id="field-decorative"
              type="checkbox"
              checked={decorative}
              onChange={(event) => setDecorative(event.target.checked)}
            />
            Decorative (no alt text needed)
          </label>
        </div>
        <div className="field">
          <label htmlFor="field-caption">Caption</label>
          <input
            id="field-caption"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="field-sourceNote">Source note</label>
          <textarea
            id="field-sourceNote"
            value={sourceNote}
            onChange={(event) => setSourceNote(event.target.value)}
            rows={2}
          />
        </div>
        <button className="button primary" type="submit" disabled={pending} aria-busy={pending}>
          SAVE
        </button>
      </form>

      <div className="media-detail-actions">
        {item.status === 'quarantined' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => media.approve(item.id, { altText, decorative }))}
          >
            APPROVE
          </button>
        )}
        {item.status === 'quarantined' && !showRejectForm && (
          <button type="button" disabled={pending} onClick={() => setShowRejectForm(true)}>
            REJECT
          </button>
        )}
        {item.status === 'approved' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => media.archive(item.id))}
          >
            ARCHIVE
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)}>
          DELETE
        </button>
      </div>

      {showRejectForm && (
        <div className="field">
          <label htmlFor="field-rejectReason">Rejection reason</label>
          <textarea
            id="field-rejectReason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={2}
          />
          <button
            type="button"
            disabled={pending || rejectReason.trim().length < 3}
            onClick={() =>
              run(async () => {
                await media.reject(item.id, rejectReason);
                setShowRejectForm(false);
              })
            }
          >
            CONFIRM REJECTION
          </button>
          <button type="button" onClick={() => setShowRejectForm(false)}>
            CANCEL
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete "${item.filename}"?`}
        description="This permanently deletes the media asset and its stored file. This cannot be undone."
        confirmLabel="DELETE"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
