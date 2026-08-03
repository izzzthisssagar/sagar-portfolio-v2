'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, media } from '@/lib/admin-api.client';

export function MediaUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      await media.upload(file, setProgress);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div
      className={`media-upload${dragging ? ' media-upload--dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void uploadFile(file);
      }}
    >
      <label htmlFor="media-upload-input">
        Upload image or PDF (drag and drop, or choose a file)
      </label>
      <input
        id="media-upload-input"
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />
      {uploading && (
        <p role="status" aria-live="polite">
          Uploading… {Math.round(progress * 100)}%
        </p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <p className="capline">
        Allowed: JPEG, PNG, WebP, AVIF images, or PDF documents. New uploads start quarantined and
        are never public until approved.
      </p>
    </div>
  );
}
