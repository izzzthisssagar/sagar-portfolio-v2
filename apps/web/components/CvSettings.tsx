'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type AdminCvDocument, type AdminMedia, cv, media } from '@/lib/admin-api.client';

export function CvSettings({ documents }: { documents: AdminCvDocument[] }) {
  const router = useRouter();
  const [approvedDocs, setApprovedDocs] = useState<AdminMedia[]>([]);
  const [mediaId, setMediaId] = useState('');
  const [title, setTitle] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    media
      .list({ status: 'approved', category: 'document', limit: 100 })
      .then((result) => setApprovedDocs(result.data))
      .catch(() => setApprovedDocs([]));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action failed.');
    } finally {
      setPending(false);
    }
  }

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mediaId || !title.trim()) {
      setError('Choose an approved PDF and enter a title.');
      return;
    }
    await run(async () => {
      await cv.create({ mediaId, title, ...(versionNote ? { versionNote } : {}) });
      setMediaId('');
      setTitle('');
      setVersionNote('');
    });
  }

  return (
    <section className="nested-editor" aria-labelledby="cv-heading">
      <h2 id="cv-heading">CV</h2>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      {documents.length === 0 ? (
        <p>No CV documents yet.</p>
      ) : (
        <ul className="nested-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <strong>{doc.title}</strong> {doc.versionNote ? `— ${doc.versionNote}` : ''}
              <span
                className={`status-badge status-badge--${doc.active ? 'published' : 'archived'}`}
              >
                {doc.active ? 'active' : 'inactive'}
              </span>
              <a href={media.fileUrl(doc.mediaId)} target="_blank" rel="noopener noreferrer">
                DOWNLOAD
              </a>
              {!doc.active && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => cv.activate(doc.id))}
                >
                  ACTIVATE
                </button>
              )}
              {!doc.active && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => cv.remove(doc.id))}
                >
                  DELETE
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={register} className="nested-form">
        <div className="field">
          <label htmlFor="cv-media">Approved PDF</label>
          <select id="cv-media" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            <option value="">Select…</option>
            {approvedDocs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename}
              </option>
            ))}
          </select>
          {approvedDocs.length === 0 && (
            <p className="capline">
              No approved PDFs yet — approve one in the media library first.
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="cv-title">Title</label>
          <input id="cv-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cv-note">Version note</label>
          <input
            id="cv-note"
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
          />
        </div>
        <button className="button" type="submit" disabled={pending}>
          REGISTER CV VERSION
        </button>
      </form>
    </section>
  );
}
