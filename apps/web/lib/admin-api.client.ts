'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)portfolio_csrf=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function apiFetchRaw(path: string, init: RequestInit = {}): Promise<unknown> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = payload?.error as
      | { code?: string; message?: string; details?: unknown }
      | undefined;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Request failed.',
      error?.details,
    );
  }
  return payload;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const payload = await apiFetchRaw(path, init);
  return ((payload as { data?: unknown } | null)?.data ?? payload) as T;
}

export interface AdminSession {
  admin: { id: string; email: string };
  activeSessions: number;
}

export const auth = {
  login: (email: string, password: string) =>
    apiFetch<{ email: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  refresh: () => apiFetch<{ email: string }>('/auth/refresh', { method: 'POST' }),
  logout: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => apiFetch<void>('/auth/logout-all', { method: 'POST' }),
  session: () => apiFetch<AdminSession>('/auth/session'),
};

export interface AdminProject {
  id: string;
  slug: string;
  title: string;
  summary: string;
  overview?: string | null;
  context?: string | null;
  responsibilities?: string | null;
  systemMap?: string | null;
  testStrategy?: string | null;
  fixAndRetest?: string | null;
  outcome?: string | null;
  lessons?: string | null;
  liveUrl?: string | null;
  githubUrl?: string | null;
  labels: string[];
  sceneState: string;
  status: 'draft' | 'review' | 'published' | 'archived';
  order: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metrics?: AdminMetric[];
  findings?: AdminFinding[];
}

export interface AdminMetric {
  id: string;
  label: string;
  value: string;
  evidence: 'confirmed' | 'pending' | 'unavailable';
  sourceNote?: string | null;
  order: number;
  projectId: string;
}

export interface AdminFinding {
  id: string;
  title: string;
  summary: string;
  severity?: string | null;
  evidenceStatus: 'confirmed' | 'pending' | 'unavailable';
  order: number;
  projectId: string;
}

/** Write-shape inputs use `undefined` for "not set" (omit the key); the
 * read shapes above use `null` because that's what the database returns.
 * Keeping these separate avoids exactOptionalPropertyTypes friction at
 * every call site. */
export interface MetricInput {
  label: string;
  value: string;
  evidence: 'confirmed' | 'pending' | 'unavailable';
  sourceNote?: string;
  order: number;
}
export interface FindingInput {
  title: string;
  summary: string;
  severity?: string;
  evidenceStatus: 'confirmed' | 'pending' | 'unavailable';
  order: number;
}

export interface ProjectListResult {
  data: AdminProject[];
  meta: { page: number; limit: number; total: number };
}

export interface ProjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminProject['status'];
  sort?: 'order' | 'title' | 'createdAt';
  direction?: 'asc' | 'desc';
}

function toQueryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface ProjectInput {
  title: string;
  slug: string;
  summary: string;
  overview?: string;
  context?: string;
  responsibilities?: string;
  systemMap?: string;
  testStrategy?: string;
  fixAndRetest?: string;
  outcome?: string;
  lessons?: string;
  liveUrl?: string;
  githubUrl?: string;
  labels?: string[];
  sceneState: string;
  order: number;
}

export const projects = {
  list: (query: ProjectListQuery = {}) =>
    apiFetchRaw(`/admin/projects${toQueryString({ ...query })}`) as Promise<ProjectListResult>,
  get: (id: string) => apiFetch<AdminProject>(`/admin/projects/${id}`),
  create: (input: ProjectInput & { status: AdminProject['status'] }) =>
    apiFetch<AdminProject>('/admin/projects', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<ProjectInput>) =>
    apiFetch<AdminProject>(`/admin/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  transition: (id: string, transition: 'draft' | 'review' | 'publish' | 'archive') =>
    apiFetch<AdminProject>(`/admin/projects/${id}/workflow`, {
      method: 'POST',
      body: JSON.stringify({ transition }),
    }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/admin/projects/${id}`, { method: 'DELETE' }),

  metrics: {
    list: (projectId: string) => apiFetch<AdminMetric[]>(`/admin/projects/${projectId}/metrics`),
    create: (projectId: string, input: MetricInput) =>
      apiFetch<AdminMetric>(`/admin/projects/${projectId}/metrics`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (projectId: string, metricId: string, input: Partial<MetricInput>) =>
      apiFetch<AdminMetric>(`/admin/projects/${projectId}/metrics/${metricId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (projectId: string, metricId: string) =>
      apiFetch<{ deleted: true }>(`/admin/projects/${projectId}/metrics/${metricId}`, {
        method: 'DELETE',
      }),
    reorder: (projectId: string, orderedIds: string[]) =>
      apiFetch<{ reordered: true }>(`/admin/projects/${projectId}/metrics/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ orderedIds }),
      }),
  },

  findings: {
    list: (projectId: string) => apiFetch<AdminFinding[]>(`/admin/projects/${projectId}/findings`),
    create: (projectId: string, input: FindingInput) =>
      apiFetch<AdminFinding>(`/admin/projects/${projectId}/findings`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (projectId: string, findingId: string, input: Partial<FindingInput>) =>
      apiFetch<AdminFinding>(`/admin/projects/${projectId}/findings/${findingId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (projectId: string, findingId: string) =>
      apiFetch<{ deleted: true }>(`/admin/projects/${projectId}/findings/${findingId}`, {
        method: 'DELETE',
      }),
    reorder: (projectId: string, orderedIds: string[]) =>
      apiFetch<{ reordered: true }>(`/admin/projects/${projectId}/findings/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ orderedIds }),
      }),
  },
};

export interface DashboardSummary {
  totalProjects: number;
  projectsByStatus: Record<string, number>;
  confirmedMetrics: number;
  pendingEvidence: number;
  activeSessions: number;
  unreadMessages: number;
  pendingMedia: number;
  recentAuditEvents: { id: string; action: string; createdAt: string; resource?: string | null }[];
  lastSuccessfulLoginAt: string | null;
  recentFailedLogins24h: number;
}

export const dashboard = {
  summary: () => apiFetch<DashboardSummary>('/admin/dashboard'),
};
