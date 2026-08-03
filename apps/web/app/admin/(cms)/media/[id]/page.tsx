import { notFound } from 'next/navigation';
import { MediaDetailForm } from '@/components/MediaDetailForm';
import { adminServer } from '@/lib/admin-api.server';

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await adminServer.getMedia(id);
  if (!item) notFound();

  return (
    <main id="main">
      <p className="eyebrow">Admin / Media / {item.filename}</p>
      <h1>{item.filename}</h1>
      <MediaDetailForm item={item} />
    </main>
  );
}
