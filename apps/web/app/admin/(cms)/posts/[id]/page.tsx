import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PostForm } from '@/components/PostForm';
import { adminServer } from '@/lib/admin-api.server';

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await adminServer.getPost(id);
  if (!post) notFound();

  return (
    <main id="main">
      <p className="eyebrow">Admin / Field Notes / Edit</p>
      <h1>{post.title}</h1>
      <p>
        <Link href={`/admin/posts/${post.id}/preview`}>PREVIEW DRAFT</Link>
      </p>
      <PostForm mode="edit" post={post} />
    </main>
  );
}
