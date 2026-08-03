import { notFound } from 'next/navigation';
import { ContactRowActions } from '@/components/ContactRowActions';
import { adminServer } from '@/lib/admin-api.server';

export default async function MessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await adminServer.getMessage(id);
  if (!message) notFound();

  return (
    <main id="main">
      <p className="eyebrow">Admin / Messages / {message.name}</p>
      <h1>{message.subject || 'No subject'}</h1>

      <dl className="media-detail-facts">
        <div>
          <dt>From</dt>
          <dd>
            {message.name} &lt;{message.email}&gt;
          </dd>
        </div>
        {message.company && (
          <div>
            <dt>Company</dt>
            <dd>{message.company}</dd>
          </div>
        )}
        <div>
          <dt>Received</dt>
          <dd>{new Date(message.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{message.status}</dd>
        </div>
      </dl>

      <p className="contact-message-body">{message.message}</p>

      <ContactRowActions message={message} />

      {message.deliveryAttempts && message.deliveryAttempts.length > 0 && (
        <section className="nested-editor">
          <h2>Delivery attempts</h2>
          <ul className="nested-list">
            {message.deliveryAttempts.map((attempt) => (
              <li key={attempt.id}>
                {new Date(attempt.createdAt).toLocaleString()} —{' '}
                {attempt.success ? 'delivered' : `failed${attempt.reason ? `: ${attempt.reason}` : ''}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
