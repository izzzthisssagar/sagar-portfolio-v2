import Link from 'next/link';
import { notes } from '@/lib/content';
export default function NotesPage() {
  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="eyebrow">Field Notes</p>
        <h1 className="display">Writing</h1>
        {notes.map((n) => (
          <article className="note" key={n.slug}>
            <p>Draft seed</p>
            <h2>
              <Link href={`/notes/${n.slug}`}>{n.title}</Link>
            </h2>
            <p>{n.excerpt}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
