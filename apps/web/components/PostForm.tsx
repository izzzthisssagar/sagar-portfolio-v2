'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type AdminPost, type PostInput, posts } from '@/lib/admin-api.client';
import { renderMarkdown } from '@/lib/markdown';
import {
  validatePostForm,
  type PostFormErrors,
  type PostFormValues,
} from '@/lib/post-form-validation';
import { slugify } from '@/lib/slugify';

function toFormValues(post: AdminPost | undefined): PostFormValues {
  return {
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    body: post?.body ?? '',
    tags: (post?.tags ?? []).join(', '),
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
    canonicalUrl: post?.canonicalUrl ?? '',
    displayOrder: String(post?.displayOrder ?? 0),
  };
}

export function PostForm({ mode, post }: { mode: 'create' | 'edit'; post?: AdminPost }) {
  const router = useRouter();
  const [values, setValues] = useState<PostFormValues>(() => toFormValues(post));
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [errors, setErrors] = useState<PostFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function set<K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) {
    setDirty(true);
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'title' && !slugTouched) next.slug = slugify(value);
      return next;
    });
  }

  const errorEntries = useMemo(
    () => Object.entries(errors) as [keyof PostFormValues, string][],
    [errors],
  );
  const previewHtml = useMemo(() => renderMarkdown(values.body), [values.body]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePostForm(values);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    const payload: PostInput = {
      title: values.title,
      slug: values.slug,
      displayOrder: Number(values.displayOrder),
      tags: values.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(values.excerpt ? { excerpt: values.excerpt } : {}),
      ...(values.body ? { body: values.body } : {}),
      ...(values.seoTitle ? { seoTitle: values.seoTitle } : {}),
      ...(values.seoDescription ? { seoDescription: values.seoDescription } : {}),
      ...(values.canonicalUrl ? { canonicalUrl: values.canonicalUrl } : {}),
    };
    try {
      if (mode === 'create') {
        const created = await posts.create(payload);
        setDirty(false);
        router.push(`/admin/posts/${created.id}`);
      } else if (post) {
        await posts.update(post.id, payload);
        setDirty(false);
        router.refresh();
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setErrors((prev) => ({ ...prev, slug: 'This slug is already in use.' }));
        } else {
          setServerError(
            [error.message, ...(Array.isArray(error.details) ? error.details : [])].join(' '),
          );
        }
      } else {
        setServerError('Could not save this post. Try again.');
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

      {mode === 'edit' && post && (
        <p className="project-status-note">
          Status: <strong>{post.status}</strong> — use the post list actions to change publication
          status.
        </p>
      )}
      {mode === 'create' && (
        <p className="project-status-note">
          New posts are always created as <strong>draft</strong>.
        </p>
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
        <label htmlFor="field-excerpt">Excerpt</label>
        <textarea
          id="field-excerpt"
          value={values.excerpt}
          onChange={(event) => set('excerpt', event.target.value)}
          rows={2}
        />
      </div>

      <div className="field">
        <div className="admin-actions-row">
          <label htmlFor="field-body">Body (Markdown)</label>
          <button type="button" onClick={() => setShowPreview((value) => !value)}>
            {showPreview ? 'EDIT' : 'PREVIEW'}
          </button>
        </div>
        {showPreview ? (
          // renderMarkdown sanitizes to a fixed tag allowlist (lib/markdown.ts) before this
          // renders it.
          <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <textarea
            id="field-body"
            value={values.body}
            onChange={(event) => set('body', event.target.value)}
            aria-describedby={errors.body ? 'field-body-error' : undefined}
            aria-invalid={Boolean(errors.body)}
            rows={16}
          />
        )}
        {errors.body && (
          <span id="field-body-error" className="field-error">
            {errors.body}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-tags">Tags (comma-separated)</label>
        <input
          id="field-tags"
          value={values.tags}
          onChange={(event) => set('tags', event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="field-seoTitle">SEO title</label>
        <input
          id="field-seoTitle"
          value={values.seoTitle}
          onChange={(event) => set('seoTitle', event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="field-seoDescription">SEO description</label>
        <textarea
          id="field-seoDescription"
          value={values.seoDescription}
          onChange={(event) => set('seoDescription', event.target.value)}
          rows={2}
        />
      </div>

      <div className="field">
        <label htmlFor="field-canonicalUrl">Canonical URL</label>
        <input
          id="field-canonicalUrl"
          type="url"
          value={values.canonicalUrl}
          onChange={(event) => set('canonicalUrl', event.target.value)}
          aria-describedby={errors.canonicalUrl ? 'field-canonicalUrl-error' : undefined}
          aria-invalid={Boolean(errors.canonicalUrl)}
        />
        {errors.canonicalUrl && (
          <span id="field-canonicalUrl-error" className="field-error">
            {errors.canonicalUrl}
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="field-displayOrder">Display order</label>
        <input
          id="field-displayOrder"
          type="number"
          value={values.displayOrder}
          onChange={(event) => set('displayOrder', event.target.value)}
          aria-describedby={errors.displayOrder ? 'field-displayOrder-error' : undefined}
          aria-invalid={Boolean(errors.displayOrder)}
        />
        {errors.displayOrder && (
          <span id="field-displayOrder-error" className="field-error">
            {errors.displayOrder}
          </span>
        )}
      </div>

      <button className="button primary" type="submit" disabled={saving} aria-busy={saving}>
        {saving ? 'SAVING…' : mode === 'create' ? 'CREATE POST' : 'SAVE CHANGES'}
      </button>
    </form>
  );
}
