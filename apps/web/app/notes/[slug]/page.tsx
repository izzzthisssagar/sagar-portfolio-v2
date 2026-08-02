import { notFound } from 'next/navigation';
import { notes } from '@/lib/content';
export function generateStaticParams() {
  return notes.map(({ slug }) => ({ slug }));
}
export default async function Note({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const note = notes.find((n) => n.slug === slug);
  if (!note) notFound();
  return (
    <main id="main" className="page-shell">
      <article className="container">
        <p className="eyebrow">
          {note.status} / {note.readingTime} min
        </p>
        <h1 className="display">{note.title}</h1>
        <p className="lede">{note.excerpt}</p>
        <p>{note.body}</p>
      </article>
    </main>
  );
}
