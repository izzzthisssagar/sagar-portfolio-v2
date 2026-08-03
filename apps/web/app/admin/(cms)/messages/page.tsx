import Link from 'next/link';
import { ContactFilters } from '@/components/ContactFilters';
import { ContactRowActions } from '@/components/ContactRowActions';
import { adminServer } from '@/lib/admin-api.server';

const STATUS_BADGE_VARIANT: Record<string, string> = {
  new: 'draft',
  read: 'draft',
  replied: 'published',
  archived: 'archived',
  spam: 'archived',
};

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? '1') || 1;
  const search = params.search ?? '';
  const status = params.status ?? '';

  const qs = new URLSearchParams({
    page: String(page),
    limit: '20',
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });
  const result = await adminServer.listMessages(`?${qs.toString()}`);
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const pageHref = (targetPage: number) =>
    `?${new URLSearchParams({ ...cleanParams, page: String(targetPage) }).toString()}`;

  return (
    <main id="main">
      <p className="eyebrow">Admin / Messages</p>
      <h1>Contact messages</h1>
      <ContactFilters search={search} status={status} />

      {!result ? (
        <p>Messages are unavailable right now. The API may be unreachable.</p>
      ) : result.data.length === 0 ? (
        <p>No messages match these filters yet.</p>
      ) : (
        <>
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col">Delivery</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((message) => {
                const lastAttempt = message.deliveryAttempts?.[0];
                return (
                  <tr key={message.id}>
                    <td>
                      {message.name}
                      <br />
                      <span className="capline">{message.email}</span>
                    </td>
                    <td>{message.subject || '—'}</td>
                    <td>
                      <span
                        className={`status-badge status-badge--${STATUS_BADGE_VARIANT[message.status]}`}
                      >
                        {message.status}
                      </span>
                    </td>
                    <td>{new Date(message.createdAt).toLocaleDateString()}</td>
                    <td>
                      {lastAttempt ? (lastAttempt.success ? 'delivered' : 'failed') : '—'}
                    </td>
                    <td>
                      <ContactRowActions message={message} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <nav aria-label="Message pagination" className="pagination">
            {page > 1 && <Link href={pageHref(page - 1)}>PREVIOUS</Link>}
            <span>
              Page {result.meta.page} · {result.meta.total} message
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
