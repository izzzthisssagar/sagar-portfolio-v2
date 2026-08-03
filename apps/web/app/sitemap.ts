import type { MetadataRoute } from 'next';
import { getPublishedPosts, getPublishedProjects } from '@/lib/public-content.server';
import { getSiteUrl } from '@/lib/seo';

const STATIC_PATHS = ['', '/about', '/work', '/notes', '/contact'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const [projects, posts] = await Promise.all([getPublishedProjects(), getPublishedPosts()]);

  const staticEntries = STATIC_PATHS.map((path) => ({ url: `${siteUrl}${path}` }));
  const projectEntries = projects.map((project) => ({ url: `${siteUrl}/work/${project.slug}` }));
  const postEntries = posts.map((post) => ({
    url: `${siteUrl}/notes/${post.slug}`,
    ...(post.publishedAt ? { lastModified: new Date(post.publishedAt) } : {}),
  }));

  return [...staticEntries, ...projectEntries, ...postEntries];
}
