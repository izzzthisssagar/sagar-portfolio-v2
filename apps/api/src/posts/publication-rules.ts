export interface PublishablePost {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
}

export function validatePostForPublication(post: PublishablePost): string[] {
  const errors: string[] = [];
  if (!post.title.trim()) errors.push('Title is required.');
  if (!post.slug.trim()) errors.push('Slug is required.');
  if (!post.excerpt.trim()) errors.push('Excerpt is required.');
  if (!post.body.trim()) errors.push('Body is required.');
  return errors;
}
