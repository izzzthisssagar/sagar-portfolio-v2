'use client';

import { useState } from 'react';
import { ApiError, type AdminFinding, projects } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

const EVIDENCE_OPTIONS = ['confirmed', 'pending', 'unavailable'] as const;
const SEVERITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low', 'Informational'] as const;

interface FindingDraft {
  title: string;
  summary: string;
  severity: (typeof SEVERITY_OPTIONS)[number];
  evidenceStatus: AdminFinding['evidenceStatus'];
}
const emptyDraft: FindingDraft = {
  title: '',
  summary: '',
  severity: 'Medium',
  evidenceStatus: 'pending',
};

export function FindingsEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: AdminFinding[];
}) {
  const [findings, setFindings] = useState(initial);
  const [draft, setDraft] = useState<FindingDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function refresh() {
    setFindings(await projects.findings.list(projectId));
  }

  async function addFinding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (draft.title.trim().length < 2 || draft.summary.trim().length < 10) {
      setError('Title and a summary of at least 10 characters are required.');
      return;
    }
    try {
      await projects.findings.create(projectId, {
        title: draft.title,
        summary: draft.summary,
        severity: draft.severity,
        evidenceStatus: draft.evidenceStatus,
        order: findings.length,
      });
      setDraft(emptyDraft);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this finding.');
    }
  }

  async function updateEvidence(
    finding: AdminFinding,
    evidenceStatus: AdminFinding['evidenceStatus'],
  ) {
    await projects.findings.update(projectId, finding.id, { evidenceStatus });
    await refresh();
  }

  async function remove(findingId: string) {
    setPendingDeleteId(null);
    await projects.findings.remove(projectId, findingId);
    await refresh();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...findings];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
    setFindings(next);
    await projects.findings.reorder(
      projectId,
      next.map((f) => f.id),
    );
  }

  return (
    <section aria-labelledby="findings-heading" className="nested-editor">
      <h2 id="findings-heading">Findings</h2>
      {error && <p role="alert">{error}</p>}
      {findings.length === 0 ? (
        <p>No findings yet.</p>
      ) : (
        <ul className="nested-list">
          {findings.map((finding, index) => (
            <li key={finding.id}>
              <strong>{finding.title}</strong>
              {finding.severity && <span className="severity-badge">{finding.severity}</span>}
              <span className={`evidence-badge evidence-badge--${finding.evidenceStatus}`}>
                {finding.evidenceStatus}
              </span>
              <p>{finding.summary}</p>
              <label className="visually-hidden" htmlFor={`finding-evidence-${finding.id}`}>
                Evidence status for {finding.title}
              </label>
              <select
                id={`finding-evidence-${finding.id}`}
                value={finding.evidenceStatus}
                onChange={(event) =>
                  updateEvidence(finding, event.target.value as AdminFinding['evidenceStatus'])
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
                aria-label={`Move ${finding.title} up`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === findings.length - 1}
                aria-label={`Move ${finding.title} down`}
              >
                ↓
              </button>
              <button type="button" onClick={() => setPendingDeleteId(finding.id)}>
                DELETE
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addFinding} className="nested-form">
        <div className="field">
          <label htmlFor="finding-title">Title</label>
          <input
            id="finding-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="finding-summary">Summary</label>
          <textarea
            id="finding-summary"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            rows={3}
          />
        </div>
        <div className="field">
          <label htmlFor="finding-severity">Severity</label>
          <select
            id="finding-severity"
            value={draft.severity}
            onChange={(e) =>
              setDraft({ ...draft, severity: e.target.value as (typeof SEVERITY_OPTIONS)[number] })
            }
          >
            {SEVERITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="finding-evidence">Evidence</label>
          <select
            id="finding-evidence"
            value={draft.evidenceStatus}
            onChange={(e) =>
              setDraft({
                ...draft,
                evidenceStatus: e.target.value as AdminFinding['evidenceStatus'],
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
          ADD FINDING
        </button>
      </form>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this finding?"
        description="This cannot be undone."
        confirmLabel="DELETE"
        danger
        onConfirm={() => pendingDeleteId && remove(pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
