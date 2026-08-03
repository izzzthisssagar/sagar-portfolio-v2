import { adminServer } from '@/lib/admin-api.server';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export default async function Dashboard() {
  const data = await adminServer.dashboard();

  if (!data) {
    return (
      <main id="main">
        <p className="eyebrow">Admin / Dashboard</p>
        <h1>Content operations</h1>
        <p>Dashboard data is unavailable right now. The API may be unreachable.</p>
      </main>
    );
  }

  const stats: [string, number][] = [
    ['Total projects', data.totalProjects],
    ['Confirmed metrics', data.confirmedMetrics],
    ['Pending evidence', data.pendingEvidence],
    ['Active sessions', data.activeSessions],
    ['Unread messages', data.unreadMessages],
    ['Failed notifications', data.failedNotifications],
    ['Published posts', data.publishedPosts],
    ['Draft posts', data.draftPosts],
    ['Pending media', data.pendingMedia],
    ['Rejected media', data.rejectedMedia],
  ];

  return (
    <main id="main">
      <p className="eyebrow">Admin / Dashboard</p>
      <h1>Content operations</h1>

      <section aria-labelledby="dashboard-stats-heading">
        <h2 id="dashboard-stats-heading" className="visually-hidden">
          Statistics
        </h2>
        <dl className="dashboard-stats">
          {stats.map(([label, value]) => (
            <div key={label} className="dashboard-stat">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="dashboard-status-heading">
        <h2 id="dashboard-status-heading">Projects by status</h2>
        {Object.keys(data.projectsByStatus).length === 0 ? (
          <p>No projects yet.</p>
        ) : (
          <ul className="dashboard-status-list">
            {Object.entries(data.projectsByStatus).map(([status, count]) => (
              <li key={status}>
                {STATUS_LABELS[status] ?? status}: {count}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dashboard-profile-heading">
        <h2 id="dashboard-profile-heading">Profile documents</h2>
        <p>
          Portrait: {data.activePortraitConfigured ? 'configured' : 'not configured'}. CV:{' '}
          {data.activeCvConfigured ? 'configured' : 'not configured'}.
        </p>
      </section>

      <section aria-labelledby="dashboard-login-heading">
        <h2 id="dashboard-login-heading">Login activity</h2>
        <p>
          Last successful login:{' '}
          {data.lastSuccessfulLoginAt
            ? new Date(data.lastSuccessfulLoginAt).toLocaleString()
            : 'none recorded yet'}
          . Failed attempts in the last 24 hours: {data.recentFailedLogins24h}.
        </p>
      </section>

      <section aria-labelledby="dashboard-audit-heading">
        <h2 id="dashboard-audit-heading">Recent audit events</h2>
        {data.recentAuditEvents.length === 0 ? (
          <p>No audit events recorded yet.</p>
        ) : (
          <table className="dashboard-audit-table">
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Resource</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAuditEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.action}</td>
                  <td>{event.resource ?? '—'}</td>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
