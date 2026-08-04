import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { renderMarkdown } from '@/lib/markdown';
import { getNonce } from '@/lib/nonce.server';
import { getPublishedPostBySlug } from '@/lib/public-content.server';
import { articleJsonLd, JsonLd } from '@/lib/seo';

// Deliberately no generateStaticParams here — see the matching comment in
// app/work/[slug]/page.tsx: this page reads the per-request CSP nonce (getNonce() ->
// headers()), which Next.js does not allow combining with static generation for the same
// route (DYNAMIC_SERVER_USAGE at request time, found by actually running a production build).
// getPublishedPostBySlug still caches via `next: { revalidate: 60 }`.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const note = await getPublishedPostBySlug(slug);
  if (!note) return {};
  const canonical = note.canonicalUrl || `/notes/${slug}`;
  return {
    title: note.seoTitle || note.title,
    description: note.seoDescription || note.excerpt,
    alternates: { canonical },
    openGraph: {
      title: note.title,
      description: note.excerpt,
      url: canonical,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: note.title,
      description: note.excerpt,
    },
  };
}

export default async function Note({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [note, nonce] = await Promise.all([getPublishedPostBySlug(slug), getNonce()]);
  if (!note) notFound();
  return (
    <main id="main" className="page-shell">
      <JsonLd data={articleJsonLd(note)} nonce={nonce} />
      <article className="container">
        <p className="eyebrow">Field Notes / {note.readingTime} min</p>
        <h1 className="display">{note.title}</h1>
        <p className="lede">{note.excerpt}</p>
        {note.tags.length > 0 && (
          <ul className="tag-list">
            {note.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <div
          className="section markdown-preview"
          // renderMarkdown sanitizes to a fixed tag allowlist (lib/markdown.ts) before this
          // renders it — the body is stored as Markdown, never raw HTML (see docs/field-notes.md).
          dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }}
        />
      </article>
    </main>
  );
}
