import 'server-only';
import { cookies } from 'next/headers';
import type {
  AdminFinding,
  AdminMetric,
  AdminProject,
  AdminSession,
  DashboardSummary,
  ProjectListResult,
} from './admin-api.client';

const API_URL = process.env.API_URL
  ? `${process.env.API_URL}/api/v1`
  : 'http://localhost:4000/api/v1';

async function adminFetchRaw(path: string): Promise<unknown | null> {
  const accessToken = (await cookies()).get('portfolio_access')?.value;
  if (!accessToken) return null;
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

async function adminFetch<T>(path: string): Promise<T | null> {
  const payload = await adminFetchRaw(path);
  if (payload === null) return null;
  return ((payload as { data?: unknown }).data ?? payload) as T;
}

export const adminServer = {
  session: (): Promise<AdminSession | null> => adminFetch('/auth/session'),
  // The list endpoint's body is `{ data, meta }` — both are wanted here, so
  // this skips adminFetch's single-level `.data` unwrap that the other
  // (single-resource) endpoints rely on.
  listProjects: (qs = ''): Promise<ProjectListResult | null> =>
    adminFetchRaw(`/admin/projects${qs}`) as Promise<ProjectListResult | null>,
  getProject: (id: string): Promise<AdminProject | null> => adminFetch(`/admin/projects/${id}`),
  listMetrics: (projectId: string): Promise<AdminMetric[] | null> =>
    adminFetch(`/admin/projects/${projectId}/metrics`),
  listFindings: (projectId: string): Promise<AdminFinding[] | null> =>
    adminFetch(`/admin/projects/${projectId}/findings`),
  dashboard: (): Promise<DashboardSummary | null> => adminFetch('/admin/dashboard'),
};
