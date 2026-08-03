'use client';

import { useEffect, useState } from 'react';
import {
  ApiError,
  type AdminEvidence,
  type AdminMedia,
  media,
  projects,
} from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

const EVIDENCE_OPTIONS = ['confirmed', 'pending', 'unavailable'] as const;

interface EvidenceDraft {
  mediaId: string;
  title: string;
  caption: string;
  evidenceStatus: AdminEvidence['evidenceStatus'];
}
const emptyDraft: EvidenceDraft = {
  mediaId: '',
  title: '',
  caption: '',
  evidenceStatus: 'pending',
};

export function EvidenceEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: AdminEvidence[];
}) {
  const [evidence, setEvidence] = useState(initial);
  const [draft, setDraft] = useState<EvidenceDraft>(emptyDraft);
  const [approvedImages, setApprovedImages] = useState<AdminMedia[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    media
      .list({ status: 'approved', category: 'image', limit: 100 })
      .then((result) => setApprovedImages(result.data))
      .catch(() => setApprovedImages([]));
  }, []);

  async function refresh() {
    setEvidence(await projects.evidence.list(projectId));
  }

  async function addEvidence(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!draft.mediaId) {
      setError('Choose an approved image.');
      return;
    }
    try {
      await projects.evidence.create(projectId, {
        mediaId: draft.mediaId,
        evidenceStatus: draft.evidenceStatus,
        order: evidence.length,
        ...(draft.title ? { title: draft.title } : {}),
        ...(draft.caption ? { caption: draft.caption } : {}),
      });
      setDraft(emptyDraft);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not attach this evidence.');
    }
  }

  async function updateStatus(row: AdminEvidence, evidenceStatus: AdminEvidence['evidenceStatus']) {
    await projects.evidence.update(projectId, row.id, { evidenceStatus });
    await refresh();
  }

  async function remove(evidenceId: string) {
    setPendingDeleteId(null);
    await projects.evidence.remove(projectId, evidenceId);
    await refresh();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...evidence];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
    setEvidence(next);
    await projects.evidence.reorder(
      projectId,
      next.map((row) => row.id),
    );
  }

  return (
    <section aria-labelledby="evidence-heading" className="nested-editor">
      <h2 id="evidence-heading">Evidence</h2>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {evidence.length === 0 ? (
        <p>No evidence attached yet.</p>
      ) : (
        <ul className="nested-list">
          {evidence.map((row, index) => (
            <li key={row.id}>
              <strong>{row.title || row.media?.filename || 'Untitled evidence'}</strong>
              <span className={`evidence-badge evidence-badge--${row.evidenceStatus}`}>
                {row.evidenceStatus}
              </span>
              <label className="visually-hidden" htmlFor={`evidence-status-${row.id}`}>
                Evidence status for {row.title || row.media?.filename}
              </label>
              <select
                id={`evidence-status-${row.id}`}
                value={row.evidenceStatus}
                onChange={(event) =>
                  updateStatus(row, event.target.value as AdminEvidence['evidenceStatus'])
                }
              >
                {EVIDENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move evidence up`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === evidence.length - 1}
                aria-label={`Move evidence down`}
              >
                ↓
              </button>
              <button type="button" onClick={() => setPendingDeleteId(row.id)}>
                DETACH
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addEvidence} className="nested-form">
        <div className="field">
          <label htmlFor="evidence-media">Approved image</label>
          <select
            id="evidence-media"
            value={draft.mediaId}
            onChange={(e) => setDraft({ ...draft, mediaId: e.target.value })}
          >
            <option value="">Select…</option>
            {approvedImages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename}
              </option>
            ))}
          </select>
          {approvedImages.length === 0 && (
            <p className="capline">
              No approved images yet — approve one in the media library first.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="evidence-title">Title</label>
          <input
            id="evidence-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="evidence-caption">Caption</label>
          <input
            id="evidence-caption"
            value={draft.caption}
            onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="evidence-status">Status</label>
          <select
            id="evidence-status"
            value={draft.evidenceStatus}
            onChange={(e) =>
              setDraft({
                ...draft,
                evidenceStatus: e.target.value as AdminEvidence['evidenceStatus'],
              })
            }
          >
            {EVIDENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="submit">
          ATTACH EVIDENCE
        </button>
      </form>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Detach this evidence?"
        description="This removes the evidence from the project. The underlying media asset is not deleted."
        confirmLabel="DETACH"
        danger
        onConfirm={() => pendingDeleteId && remove(pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
