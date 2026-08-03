import Link from 'next/link';
import { getPublishedPosts } from '@/lib/public-content.server';

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
