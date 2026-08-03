import Link from 'next/link';
import type { AdminMedia } from '@/lib/admin-api.client';

// Computed directly (not via `media.fileUrl` from admin-api.client) so this can stay a Server
// Component — admin-api.client is `'use client'`, and a Server Component importing a function
// export from it (rather than only rendering a client component) gets a proxy instead of the
// real function.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const mediaFileUrl = (id: string) => `${API_URL}/admin/media/${id}/file`;

const STATUS_LABELS: Record<AdminMedia['status'], string> = {
  quarantined: 'Quarantined',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
};
// Reuses the project-list status-badge palette (published=green, draft/review=orange,
// archived=muted) rather than inventing a parallel color scale for media status.
const STATUS_BADGE_VARIANT: Record<AdminMedia['status'], string> = {
  approved: 'published',
  quarantined: 'draft',
  rejected: 'draft',
  archived: 'archived',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaCard({ item }: { item: AdminMedia }) {
  return (
    <Link href={`/admin/media/${item.id}`} className="media-card">
      <div className="media-card-thumb">
        {item.category === 'image' ? (
          // The admin file route (JwtAuthGuard-only, works for any status) — not the eventual
          // public delivery route, which will only ever serve APPROVED assets.
          // eslint-disable-next-line @next/next/no-img-element -- authenticated, non-public asset
          <img src={mediaFileUrl(item.id)} alt={item.altText ?? ''} loading="lazy" />
        ) : (
          <span aria-hidden="true" className="media-card-doc-icon">
            PDF
          </span>
        )}
      </div>
      <div className="media-card-body">
        <p className="media-card-filename">{item.filename}</p>
        <span className={`status-badge status-badge--${STATUS_BADGE_VARIANT[item.status]}`}>
          {STATUS_LABELS[item.status]}
        </span>
        <p className="capline">
          {item.category} · {formatBytes(item.byteSize)}
          {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
        </p>
      </div>
    </Link>
  );
}
