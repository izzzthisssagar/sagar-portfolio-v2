import 'server-only';
import type { ProjectDetailRecord, ProjectRecord } from '@portfolio/types';
import { projects as fallbackProjects } from './content';

const API_URL = process.env.API_URL
  ? `${process.env.API_URL}/api/v1`
  : 'http://localhost:4000/api/v1';

async function publicFetch<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const payload = await response.json();
    return (payload.data ?? payload) as T;
  } catch {
    return null;
  }
}

/**
 * Database-backed published project content. Falls back to the labelled
 * static seed only outside production (local dev without a running API) —
 * production never silently serves stale fallback data.
 */
export async function getPublishedProjects(): Promise<ProjectRecord[]> {
  const data = await publicFetch<ProjectRecord[]>('/projects?limit=100&sort=order&direction=asc');
  if (data) return data;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[public-content] API unavailable — using local development fallback content.');
    return fallbackProjects.filter((project) => project.status === 'published');
  }
  return [];
}

export async function getPublishedProjectBySlug(slug: string): Promise<ProjectDetailRecord | null> {
  const data = await publicFetch<ProjectDetailRecord>(`/projects/${slug}`);
  if (data) return data;
  if (process.env.NODE_ENV !== 'production') {
    const fallback = fallbackProjects.find(
      (project) => project.slug === slug && project.status === 'published',
    );
    if (fallback) {
      console.warn(
        `[public-content] API unavailable — using local development fallback for "${slug}".`,
      );
      return { ...fallback, findings: [] };
    }
  }
  return null;
}
