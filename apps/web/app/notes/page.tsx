import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublishedPosts } from '@/lib/public-content.server';

// Forced dynamic — see the matching comment in apps/web/app/work/page.tsx: a per-request CSP
// nonce (proxy.ts) only reaches Next's own framework-injected inline scripts on dynamically
// rendered pages; a statically prerendered one bakes in a build-time nonce that never matches
// the real per-request CSP header, and CSP-enforcing browsers block those scripts outright.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Field Notes',
  description: 'Writing on testing practice, tooling, and what breaks in production.',
  alternates: { canonical: '/notes' },
};

export default async function NotesPage() {
  const notes = await getPublishedPosts();
  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="eyebrow">Field Notes</p>
        <h1 className="display">Writing</h1>
        {notes.length === 0 && <p>No Field Notes published yet.</p>}
        {notes.map((note) => (
          <article className="note" key={note.slug}>
            <p className="eyebrow">{note.readingTime} min</p>
            <h2>
              <Link href={`/notes/${note.slug}`}>{note.title}</Link>
            </h2>
            <p>{note.excerpt}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
