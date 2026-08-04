import Link from 'next/link';
import { PostFilters } from '@/components/PostFilters';
import { PostRowActions } from '@/components/PostRowActions';
import { adminServer } from '@/lib/admin-api.server';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;
  const search = params.search ?? '';
  const status = params.status ?? '';
  const tag = params.tag ?? '';

  const qs = new URLSearchParams({
    page: String(page),
    limit: '20',
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(tag ? { tag } : {}),
  });
  const result = await adminServer.listPosts(`?${qs.toString()}`);
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const pageHref = (targetPage: number) =>
    `?${new URLSearchParams({ ...cleanParams, page: String(targetPage) }).toString()}`;

  return (
    <main id="main">
      <p className="eyebrow">Admin / Field Notes</p>
      <h1>Field Notes</h1>
      <div className="admin-actions-row">
        <Link className="button primary" href="/admin/posts/new">
          NEW POST
        </Link>
      </div>
      <PostFilters search={search} status={status} tag={tag} />

      {!result ? (
        <p>Posts are unavailable right now. The API may be unreachable.</p>
      ) : result.data.length === 0 ? (
        <p>No posts match these filters yet.</p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="Field Notes posts" tabIndex={0}>
            <table className="project-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Status</th>
                  <th scope="col">Tags</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Published</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((post) => (
                  <tr key={post.id}>
                    <td>{post.title}</td>
                    <td>{post.slug}</td>
                    <td>
                      <span className={`status-badge status-badge--${post.status}`}>
                        {STATUS_LABELS[post.status] ?? post.status}
                      </span>
                    </td>
                    <td>{post.tags.join(', ') || '—'}</td>
                    <td>{new Date(post.updatedAt).toLocaleDateString()}</td>
                    <td>
                      {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : '—'}
                    </td>
                    <td>
                      <PostRowActions post={post} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Post pagination" className="pagination">
            {page > 1 && <Link href={pageHref(page - 1)}>PREVIOUS</Link>}
            <span>
              Page {result.meta.page} · {result.meta.total} post
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
