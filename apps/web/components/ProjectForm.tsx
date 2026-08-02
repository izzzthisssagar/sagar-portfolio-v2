'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, type AdminProject, type ProjectInput, projects } from '@/lib/admin-api.client';
import {
  validateProjectForm,
  type ProjectFormErrors,
  type ProjectFormValues,
} from '@/lib/project-form-validation';
import { slugify } from '@/lib/slugify';

const SCENE_STATES = [
  'sealed',
  'exploded',
  'mastery',
  'inspection',
  'fault',
  'verified',
  'rift',
] as const;

const TEXT_FIELDS: {
  key: keyof ProjectFormValues;
  label: string;
  help?: string;
  long?: boolean;
}[] = [
  { key: 'overview', label: 'Overview', long: true },
  { key: 'context', label: 'Context', long: true },
  { key: 'responsibilities', label: 'Responsibilities', long: true },
  { key: 'systemMap', label: 'System map / architecture', long: true },
  { key: 'testStrategy', label: 'Test strategy', long: true },
  { key: 'fixAndRetest', label: 'Fix and retest', long: true },
  { key: 'outcome', label: 'Outcome', long: true },
  { key: 'lessons', label: 'Lessons and future improvements', long: true },
];

function toFormValues(project: AdminProject | undefined): ProjectFormValues {
  return {
    title: project?.title ?? '',
    slug: project?.slug ?? '',
    summary: project?.summary ?? '',
    overview: project?.overview ?? '',
    context: project?.context ?? '',
    responsibilities: project?.responsibilities ?? '',
    systemMap: project?.systemMap ?? '',
    testStrategy: project?.testStrategy ?? '',
    fixAndRetest: project?.fixAndRetest ?? '',
    outcome: project?.outcome ?? '',
    lessons: project?.lessons ?? '',
    liveUrl: project?.liveUrl ?? '',
    githubUrl: project?.githubUrl ?? '',
    labels: (project?.labels ?? []).join(', '),
    sceneState: project?.sceneState ?? 'inspection',
    order: String(project?.order ?? 0),
  };
}

export function ProjectForm({
  mode,
  project,
}: {
  mode: 'create' | 'edit';
  project?: AdminProject;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProjectFormValues>(() => toFormValues(project));
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [status, setStatus] = useState<AdminProject['status']>(project?.status ?? 'draft');
  const [errors, setErrors] = useState<ProjectFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
    setDirty(true);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = slugify(value);
      return next;
    });
  }

  const errorEntries = useMemo(
    () => Object.entries(errors) as [keyof ProjectFormValues, string][],
    [errors],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProjectForm(values);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    const optionalText: [keyof ProjectFormValues, keyof ProjectInput][] = [
      ['overview', 'overview'],
      ['context', 'context'],
      ['responsibilities', 'responsibilities'],
      ['systemMap', 'systemMap'],
      ['testStrategy', 'testStrategy'],
      ['fixAndRetest', 'fixAndRetest'],
      ['outcome', 'outcome'],
      ['lessons', 'lessons'],
      ['liveUrl', 'liveUrl'],
      ['githubUrl', 'githubUrl'],
    ];
    const payload: ProjectInput = {
      title: values.title,
      slug: values.slug,
      summary: values.summary,
      sceneState: values.sceneState,
      order: Number(values.order),
      labels: values.labels
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      ...Object.fromEntries(
        optionalText
          .filter(([formKey]) => values[formKey])
          .map(([formKey, payloadKey]) => [payloadKey, values[formKey]]),
      ),
    };
    try {
      if (mode === 'create') {
        const created = await projects.create({ ...payload, status });
        setDirty(false);
        router.push(`/admin/projects/${created.id}`);
      } else if (project) {
        await projects.update(project.id, payload);
        setDirty(false);
        router.refresh();
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setErrors((prev) => ({ ...prev, slug: 'This slug is already in use.' }));
        } else {
          setServerError(error.message);
        }
      } else {
        setServerError('Could not save this project. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="project-form">
      {errorEntries.length > 0 && (
        <div className="error-summary" role="alert">
          <p>Fix the following before saving:</p>
          <ul>
            {errorEntries.map(([key, message]) => (
              <li key={key}>
                <a href={`#field-${key}`}>{message}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {serverError && (
        <p role="alert" className="server-error">
          {serverError}
        </p>
      )}

      {mode === 'edit' && project && (
        <p className="project-status-note">
          Status: <strong>{project.status}</strong> — use the project list actions to change
          publication status.
        </p>
      )}
      {mode === 'create' && (
        <div className="field">
          <label htmlFor="field-status">Initial status</label>
          <select
            id="field-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminProject['status'])}
          >
            <option value="draft">Draft</option>
            <option value="review">In review</option>
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="field-title">Title</label>
        <input
          id="field-title"
          value={values.title}
          onChange={(event) => set('title', event.target.value)}
          aria-describedby={errors.title ? 'field-title-error' : undefined}
          aria-invalid={Boolean(errors.title)}
        />
        {errors.title && (
          <span id="field-title-error" className="field-error">
            {errors.title}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-slug">Slug</label>
        <input
          id="field-slug"
          value={values.slug}
          onChange={(event) => {
            setSlugTouched(true);
            set('slug', slugify(event.target.value));
          }}
          aria-describedby={errors.slug ? 'field-slug-error' : undefined}
          aria-invalid={Boolean(errors.slug)}
        />
        {errors.slug && (
          <span id="field-slug-error" className="field-error">
            {errors.slug}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-summary">Summary</label>
        <textarea
          id="field-summary"
          value={values.summary}
          onChange={(event) => set('summary', event.target.value)}
          aria-describedby={errors.summary ? 'field-summary-error' : undefined}
          aria-invalid={Boolean(errors.summary)}
          rows={3}
        />
        {errors.summary && (
          <span id="field-summary-error" className="field-error">
            {errors.summary}
          </span>
        )}
      </div>

      {TEXT_FIELDS.map(({ key, label }) => (
        <div className="field" key={key}>
          <label htmlFor={`field-${key}`}>{label}</label>
          <textarea
            id={`field-${key}`}
            value={values[key]}
            onChange={(event) => set(key, event.target.value)}
            rows={4}
          />
        </div>
      ))}

      <div className="field">
        <label htmlFor="field-liveUrl">Live URL</label>
        <input
          id="field-liveUrl"
          type="url"
          value={values.liveUrl}
          onChange={(event) => set('liveUrl', event.target.value)}
          aria-describedby={errors.liveUrl ? 'field-liveUrl-error' : undefined}
          aria-invalid={Boolean(errors.liveUrl)}
        />
        {errors.liveUrl && (
          <span id="field-liveUrl-error" className="field-error">
            {errors.liveUrl}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-githubUrl">GitHub URL</label>
        <input
          id="field-githubUrl"
          type="url"
          value={values.githubUrl}
          onChange={(event) => set('githubUrl', event.target.value)}
          aria-describedby={errors.githubUrl ? 'field-githubUrl-error' : undefined}
          aria-invalid={Boolean(errors.githubUrl)}
        />
        {errors.githubUrl && (
          <span id="field-githubUrl-error" className="field-error">
            {errors.githubUrl}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-labels">Architecture labels (comma-separated)</label>
        <input
          id="field-labels"
          value={values.labels}
          onChange={(event) => set('labels', event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="field-sceneState">Scene state</label>
        <select
          id="field-sceneState"
          value={values.sceneState}
          onChange={(event) => set('sceneState', event.target.value)}
        >
          {SCENE_STATES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="field-order">Display order</label>
        <input
          id="field-order"
          type="number"
          value={values.order}
          onChange={(event) => set('order', event.target.value)}
          aria-describedby={errors.order ? 'field-order-error' : undefined}
          aria-invalid={Boolean(errors.order)}
        />
        {errors.order && (
          <span id="field-order-error" className="field-error">
            {errors.order}
          </span>
        )}
      </div>

      <button className="button primary" type="submit" disabled={saving} aria-busy={saving}>
        {saving ? 'SAVING…' : mode === 'create' ? 'CREATE PROJECT' : 'SAVE CHANGES'}
      </button>
    </form>
  );
}
