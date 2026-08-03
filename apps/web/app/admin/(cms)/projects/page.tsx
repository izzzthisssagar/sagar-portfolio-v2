import Link from 'next/link';
import { ProjectFilters } from '@/components/ProjectFilters';
import { ProjectRowActions } from '@/components/ProjectRowActions';
import { adminServer } from '@/lib/admin-api.server';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;
  const search = params.search ?? '';
  const status = params.status ?? '';
  const sort = params.sort ?? 'order';
  const direction = params.direction === 'desc' ? 'desc' : 'asc';

  const qs = new URLSearchParams({
    page: String(page),
    limit: '20',
    sort,
    direction,
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });
  const result = await adminServer.listProjects(`?${qs.toString()}`);
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const pageHref = (targetPage: number) =>
    `?${new URLSearchParams({ ...cleanParams, page: String(targetPage) }).toString()}`;

  return (
    <main id="main">
      <p className="eyebrow">Admin / Projects</p>
      <h1>Projects</h1>
      <div className="admin-actions-row">
        <Link className="button primary" href="/admin/projects/new">
          NEW PROJECT
        </Link>
      </div>
      <ProjectFilters search={search} status={status} sort={sort} direction={direction} />

      {!result ? (
        <p>Projects are unavailable right now. The API may be unreachable.</p>
      ) : result.data.length === 0 ? (
        <p>No projects match these filters yet.</p>
      ) : (
        <>
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Slug</th>
                <th scope="col">Status</th>
                <th scope="col">Order</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((project) => (
                <tr key={project.id}>
                  <td>{project.title}</td>
                  <td>{project.slug}</td>
                  <td>
                    <span className={`status-badge status-badge--${project.status}`}>
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </td>
                  <td>{project.order}</td>
                  <td>{new Date(project.updatedAt).toLocaleDateString()}</td>
                  <td>
                    <ProjectRowActions project={project} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <nav aria-label="Project pagination" className="pagination">
            {page > 1 && <Link href={pageHref(page - 1)}>PREVIOUS</Link>}
            <span>
              Page {result.meta.page} · {result.meta.total} project
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
