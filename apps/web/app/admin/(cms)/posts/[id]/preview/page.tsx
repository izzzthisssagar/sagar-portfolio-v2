import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminServer } from '@/lib/admin-api.server';
import { renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function PostPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await adminServer.getPost(id);
  if (!post) notFound();

  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="draft-preview-banner" role="status">
          DRAFT PREVIEW — status: {post.status}. Not publicly accessible.
        </p>
        <article>
          <p className="eyebrow">Preview</p>
          <h1 className="display">{post.title}</h1>
          {post.excerpt && <p className="lede">{post.excerpt}</p>}
          {post.tags.length > 0 && (
            <ul className="tag-list">
              {post.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <div
            className="section markdown-preview"
            // renderMarkdown sanitizes to a fixed tag allowlist (lib/markdown.ts); this is the
            // same rendering path the public article page uses.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
          />
        </article>
      </div>
    </main>
  );
}
