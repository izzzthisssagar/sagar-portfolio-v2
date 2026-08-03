'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  type AdminMedia,
  type AdminProfile,
  media,
  profile,
} from '@/lib/admin-api.client';

export function PortraitSettings({ profile: initialProfile }: { profile: AdminProfile | null }) {
  const router = useRouter();
  const [approvedImages, setApprovedImages] = useState<AdminMedia[]>([]);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    media
      .list({ status: 'approved', category: 'image', limit: 100 })
      .then((result) => setApprovedImages(result.data))
      .catch(() => setApprovedImages([]));
  }, []);

  async function activate() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      await profile.setPortrait(selected);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the portrait.');
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    setPending(true);
    setError(null);
    try {
      await profile.clearPortrait();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not clear the portrait.');
    } finally {
      setPending(false);
    }
  }

  if (!initialProfile) {
    return (
      <section className="nested-editor">
        <h2>Portrait</h2>
        <p>No Profile row exists yet — run the content seed before managing the portrait.</p>
      </section>
    );
  }

  return (
    <section className="nested-editor" aria-labelledby="portrait-heading">
      <h2 id="portrait-heading">Portrait</h2>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {initialProfile.portraitMedia ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated admin preview
        <img
          src={media.fileUrl(initialProfile.portraitMedia.id)}
          alt={initialProfile.portraitMedia.altText ?? ''}
          className="portrait-settings-preview"
        />
      ) : (
        <p>No portrait configured.</p>
      )}
      <div className="field">
        <label htmlFor="portrait-select">Approved image</label>
        <select id="portrait-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
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
      <div className="admin-actions-row">
        <button type="button" disabled={pending || !selected} onClick={activate}>
          SET PORTRAIT
        </button>
        {initialProfile.portraitMedia && (
          <button type="button" disabled={pending} onClick={clear}>
            CLEAR PORTRAIT
          </button>
        )}
      </div>
    </section>
  );
}
