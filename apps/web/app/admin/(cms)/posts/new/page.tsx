import { PostForm } from '@/components/PostForm';

export default function NewPostPage() {
  return (
    <main id="main">
      <p className="eyebrow">Admin / Field Notes / New</p>
      <h1>New post</h1>
      <PostForm mode="create" />
    </main>
  );
}
