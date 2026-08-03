import Link from 'next/link';
import { MediaCard } from '@/components/MediaCard';
import { MediaFilters } from '@/components/MediaFilters';
import { MediaUploadForm } from '@/components/MediaUploadForm';
import { adminServer } from '@/lib/admin-api.server';

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;
  const search = params.search ?? '';
  const status = params.status ?? '';
  const category = params.category ?? '';

  const qs = new URLSearchParams({
    page: String(page),
    limit: '24',
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
  });
  const result = await adminServer.listMedia(`?${qs.toString()}`);
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const pageHref = (targetPage: number) =>
    `?${new URLSearchParams({ ...cleanParams, page: String(targetPage) }).toString()}`;

  return (
    <main id="main">
      <p className="eyebrow">Admin / Media</p>
      <h1>Media library</h1>
      <MediaUploadForm />
      <MediaFilters search={search} status={status} category={category} />

      {!result ? (
        <p>Media is unavailable right now. The API may be unreachable.</p>
      ) : result.data.length === 0 ? (
        <p>No media matches these filters yet.</p>
      ) : (
        <>
          <div className="media-grid">
            {result.data.map((item) => (
              <MediaCard key={item.id} item={item} />
            ))}
          </div>
          <nav aria-label="Media pagination" className="pagination">
            {page > 1 && <Link href={pageHref(page - 1)}>PREVIOUS</Link>}
            <span>
              Page {result.meta.page} · {result.meta.total} asset
              {result.meta.total === 1 ? '' : 's'}
            </span>
            {page * result.meta.limit < result.meta.total && (
              <Link href={pageHref(page + 1)}>NEXT</Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
