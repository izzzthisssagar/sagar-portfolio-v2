'use client';

import { useState } from 'react';
import { ApiError, type AdminMetric, projects } from '@/lib/admin-api.client';
import { ConfirmDialog } from './ConfirmDialog';

const EVIDENCE_OPTIONS = ['confirmed', 'pending', 'unavailable'] as const;

interface MetricDraft {
  label: string;
  value: string;
  evidence: AdminMetric['evidence'];
  sourceNote: string;
}
const emptyDraft: MetricDraft = { label: '', value: '', evidence: 'pending', sourceNote: '' };

export function MetricsEditor({ projectId, initial }: { projectId: string; initial: AdminMetric[] }) {
  const [metrics, setMetrics] = useState(initial);
  const [draft, setDraft] = useState<MetricDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function refresh() {
    setMetrics(await projects.metrics.list(projectId));
  }

  async function addMetric(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!draft.label.trim() || !draft.value.trim()) {
      setError('Label and value are required.');
      return;
    }
    try {
      await projects.metrics.create(projectId, {
        label: draft.label,
        value: draft.value,
        evidence: draft.evidence,
        ...(draft.sourceNote ? { sourceNote: draft.sourceNote } : {}),
        order: metrics.length,
      });
      setDraft(emptyDraft);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this metric.');
    }
  }

  async function updateEvidence(metric: AdminMetric, evidence: AdminMetric['evidence']) {
    await projects.metrics.update(projectId, metric.id, { evidence });
    await refresh();
  }

  async function remove(metricId: string) {
    setPendingDeleteId(null);
    await projects.metrics.remove(projectId, metricId);
    await refresh();
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...metrics];
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= next.length) return;
    [next[index], next[swapIndex]] = [next[swapIndex]!, next[index]!];
    setMetrics(next);
    await projects.metrics.reorder(projectId, next.map((m) => m.id));
  }

  return (
    <section aria-labelledby="metrics-heading" className="nested-editor">
      <h2 id="metrics-heading">Metrics</h2>
      {error && <p role="alert">{error}</p>}
      {metrics.length === 0 ? (
        <p>No metrics yet.</p>
      ) : (
        <ul className="nested-list">
          {metrics.map((metric, index) => (
            <li key={metric.id}>
              <strong>{metric.value}</strong> {metric.label}
              <span className={`evidence-badge evidence-badge--${metric.evidence}`}>{metric.evidence}</span>
              <label className="visually-hidden" htmlFor={`metric-evidence-${metric.id}`}>
                Evidence status for {metric.label}
              </label>
              <select
                id={`metric-evidence-${metric.id}`}
                value={metric.evidence}
                onChange={(event) => updateEvidence(metric, event.target.value as AdminMetric['evidence'])}
              >
                {EVIDENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${metric.label} up`}>
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === metrics.length - 1}
                aria-label={`Move ${metric.label} down`}
              >
                ↓
              </button>
              <button type="button" onClick={() => setPendingDeleteId(metric.id)}>
                DELETE
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addMetric} className="nested-form">
        <div className="field">
          <label htmlFor="metric-label">Label</label>
          <input id="metric-label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="metric-value">Value</label>
          <input id="metric-value" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="metric-evidence">Evidence</label>
          <select
            id="metric-evidence"
            value={draft.evidence}
            onChange={(e) => setDraft({ ...draft, evidence: e.target.value as AdminMetric['evidence'] })}
          >
            {EVIDENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="metric-source">Source note</label>
          <input id="metric-source" value={draft.sourceNote} onChange={(e) => setDraft({ ...draft, sourceNote: e.target.value })} />
        </div>
        <button className="button" type="submit">
          ADD METRIC
        </button>
      </form>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this metric?"
        description="This cannot be undone."
        confirmLabel="DELETE"
        danger
        onConfirm={() => pendingDeleteId && remove(pendingDeleteId)}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  );
}
