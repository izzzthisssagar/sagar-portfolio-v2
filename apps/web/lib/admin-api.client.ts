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

/** Endpoints that must never trigger a refresh-and-retry themselves — retrying
 * a failed login/refresh/logout as if it were an expired session would either
 * loop or mask a real credential error as a session hiccup. */
const NO_REFRESH_RETRY_PATHS = new Set([
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/logout-all',
]);

/** Single in-flight refresh promise shared across all callers so that several
 * requests failing with an expired access token at once trigger exactly one
 * `/auth/refresh` call, not one per request. */
let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const headers = new Headers();
      const csrf = readCsrfToken();
      if (csrf) headers.set('X-CSRF-Token', csrf);
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/admin/login?returnTo=${returnTo}`);
}

async function apiFetchRaw(
  path: string,
  init: RequestInit = {},
  isRetry = false,
): Promise<unknown> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  // A FormData body (multipart upload) must never get an explicit Content-Type — the browser
  // sets it itself, including the multipart boundary. Only default to JSON for other bodies.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !isRetry && !NO_REFRESH_RETRY_PATHS.has(path)) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetchRaw(path, init, true);
    redirectToLogin();
  }

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
  // `payload?.data ?? payload` would be wrong here: some endpoints (e.g. GET /admin/profile
  // before a Profile row exists) legitimately return `{ data: null }`, and `??` treats that null
  // as absent, falling back to the whole envelope instead of the intended `null`.
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  return data as T;
}

export interface AdminSession {
  admin: { id: string; email: string };
  activeSessions: number;
}

export const auth = {
  login: (email: string, password: string) =>
    apiFetch<{ email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
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
  evidence?: AdminEvidence[];
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

export interface AdminEvidence {
  id: string;
  title?: string | null;
  caption?: string | null;
  altText?: string | null;
  sourceNote?: string | null;
  evidenceStatus: 'confirmed' | 'pending' | 'unavailable';
  order: number;
  projectId: string;
  mediaId: string;
  media?: AdminMedia;
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
export interface EvidenceInput {
  mediaId: string;
  title?: string;
  caption?: string;
  altText?: string;
  sourceNote?: string;
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
  /** Every new project is created as `draft` by the API regardless of what's
   * sent — publication only ever happens through `transition('publish')`,
   * which runs publish validation. There is no `status` input here. */
  create: (input: ProjectInput) =>
    apiFetch<AdminProject>('/admin/projects', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<ProjectInput>) =>
    apiFetch<AdminProject>(`/admin/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  transition: (id: string, transition: 'draft' | 'review' | 'publish' | 'archive') =>
    apiFetch<AdminProject>(`/admin/projects/${id}/workflow`, {
      method: 'POST',
      body: JSON.stringify({ transition }),
    }),
  remove: (id: string) =>
    apiFetch<{ deleted: true }>(`/admin/projects/${id}`, { method: 'DELETE' }),

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

  evidence: {
    list: (projectId: string) => apiFetch<AdminEvidence[]>(`/admin/projects/${projectId}/evidence`),
    create: (projectId: string, input: EvidenceInput) =>
      apiFetch<AdminEvidence>(`/admin/projects/${projectId}/evidence`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (projectId: string, evidenceId: string, input: Partial<EvidenceInput>) =>
      apiFetch<AdminEvidence>(`/admin/projects/${projectId}/evidence/${evidenceId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (projectId: string, evidenceId: string) =>
      apiFetch<{ deleted: true }>(`/admin/projects/${projectId}/evidence/${evidenceId}`, {
        method: 'DELETE',
      }),
    reorder: (projectId: string, orderedIds: string[]) =>
      apiFetch<{ reordered: true }>(`/admin/projects/${projectId}/evidence/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ orderedIds }),
      }),
  },
};

export interface AdminPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  status: 'draft' | 'review' | 'published' | 'archived';
  publishedAt?: string | null;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl?: string | null;
  displayOrder: number;
  featuredImageId?: string | null;
  featuredImage?: { id: string; altText: string | null; status: string } | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PostInput {
  title: string;
  slug: string;
  excerpt?: string;
  body?: string;
  tags?: string[];
  featuredImageId?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  displayOrder?: number;
}

export interface PostListResult {
  data: AdminPost[];
  meta: { page: number; limit: number; total: number };
}

export interface PostListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminPost['status'];
  tag?: string;
}

export const posts = {
  list: (query: PostListQuery = {}) =>
    apiFetchRaw(`/admin/posts${toQueryString({ ...query })}`) as Promise<PostListResult>,
  get: (id: string) => apiFetch<AdminPost>(`/admin/posts/${id}`),
  /** Every new post is created as `draft` regardless of what's sent — publication only ever
   * happens through `transition('publish')`, which runs publish validation. */
  create: (input: PostInput) =>
    apiFetch<AdminPost>('/admin/posts', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<PostInput>) =>
    apiFetch<AdminPost>(`/admin/posts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  transition: (id: string, transition: 'draft' | 'review' | 'publish' | 'archive') =>
    apiFetch<AdminPost>(`/admin/posts/${id}/workflow`, {
      method: 'POST',
      body: JSON.stringify({ transition }),
    }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/admin/posts/${id}`, { method: 'DELETE' }),
};

export interface AdminMedia {
  id: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  extension: string;
  category: 'image' | 'document';
  byteSize: number;
  sha256: string;
  status: 'quarantined' | 'approved' | 'rejected' | 'archived';
  altText: string | null;
  decorative: boolean;
  caption: string | null;
  sourceNote: string | null;
  rejectionReason: string | null;
  width: number | null;
  height: number | null;
  createdById: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface MediaListResult {
  data: AdminMedia[];
  meta: { page: number; limit: number; total: number };
}

export interface MediaListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminMedia['status'];
  category?: AdminMedia['category'];
}

export interface MediaUpdateInput {
  altText?: string;
  decorative?: boolean;
  caption?: string;
  sourceNote?: string;
}

/** XMLHttpRequest, not fetch — this is the one call site that needs real upload-progress events,
 * which fetch has no API for. Mirrors apiFetchRaw's auth/CSRF/error-envelope handling by hand. */
function uploadMediaFile(file: File, onProgress?: (fraction: number) => void): Promise<AdminMedia> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/admin/media`);
    xhr.withCredentials = true;
    const csrf = readCsrfToken();
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let payload: { data?: AdminMedia; error?: { code?: string; message?: string } } | null = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.data) {
        resolve(payload.data);
      } else {
        reject(
          new ApiError(
            xhr.status,
            payload?.error?.code ?? 'UNKNOWN',
            payload?.error?.message ?? 'Upload failed.',
          ),
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload failed — network error.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

export const media = {
  list: (query: MediaListQuery = {}) =>
    apiFetchRaw(`/admin/media${toQueryString({ ...query })}`) as Promise<MediaListResult>,
  get: (id: string) => apiFetch<AdminMedia>(`/admin/media/${id}`),
  fileUrl: (id: string) => `${API_URL}/admin/media/${id}/file`,
  upload: uploadMediaFile,
  update: (id: string, input: MediaUpdateInput) =>
    apiFetch<AdminMedia>(`/admin/media/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  approve: (id: string, input: { altText?: string; decorative?: boolean } = {}) =>
    apiFetch<AdminMedia>(`/admin/media/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (id: string, reason: string) =>
    apiFetch<AdminMedia>(`/admin/media/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  archive: (id: string) => apiFetch<AdminMedia>(`/admin/media/${id}/archive`, { method: 'POST' }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/admin/media/${id}`, { method: 'DELETE' }),
};

export interface AdminProfile {
  id: string;
  name: string;
  headline: string;
  bio: string;
  location: string;
  availability: string;
  email?: string | null;
  portraitMediaId?: string | null;
  portraitMedia?: { id: string; altText: string | null; status: string } | null;
}

export const profile = {
  get: () => apiFetch<AdminProfile | null>('/admin/profile'),
  setPortrait: (mediaId: string) =>
    apiFetch<AdminProfile>('/admin/profile/portrait', {
      method: 'POST',
      body: JSON.stringify({ mediaId }),
    }),
  clearPortrait: () => apiFetch<AdminProfile>('/admin/profile/portrait', { method: 'DELETE' }),
};

export interface AdminCvDocument {
  id: string;
  title: string;
  versionNote?: string | null;
  active: boolean;
  createdAt: string;
  mediaId: string;
  media?: AdminMedia;
}

export const cv = {
  list: () => apiFetch<AdminCvDocument[]>('/admin/cv'),
  create: (input: { mediaId: string; title: string; versionNote?: string }) =>
    apiFetch<AdminCvDocument>('/admin/cv', { method: 'POST', body: JSON.stringify(input) }),
  activate: (id: string) =>
    apiFetch<AdminCvDocument>(`/admin/cv/${id}/activate`, { method: 'POST' }),
  remove: (id: string) => apiFetch<{ deleted: true }>(`/admin/cv/${id}`, { method: 'DELETE' }),
};

export interface AdminContactDeliveryAttempt {
  id: string;
  success: boolean;
  reason?: string | null;
  createdAt: string;
}

export interface AdminContactMessage {
  id: string;
  name: string;
  email: string;
  subject?: string | null;
  company?: string | null;
  message: string;
  status: 'new' | 'read' | 'replied' | 'archived' | 'spam';
  createdAt: string;
  deliveryAttempts?: AdminContactDeliveryAttempt[];
}

export interface ContactMessageListResult {
  data: AdminContactMessage[];
  meta: { page: number; limit: number; total: number };
}

export interface ContactMessageListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminContactMessage['status'];
}

export const messages = {
  list: (query: ContactMessageListQuery = {}) =>
    apiFetchRaw(
      `/admin/messages${toQueryString({ ...query })}`,
    ) as Promise<ContactMessageListResult>,
  get: (id: string) => apiFetch<AdminContactMessage>(`/admin/messages/${id}`),
  updateStatus: (id: string, status: AdminContactMessage['status']) =>
    apiFetch<AdminContactMessage>(`/admin/messages/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  remove: (id: string) =>
    apiFetch<{ deleted: true }>(`/admin/messages/${id}`, { method: 'DELETE' }),
  retryNotification: (id: string) =>
    apiFetch<AdminContactMessage>(`/admin/messages/${id}/retry-notification`, { method: 'POST' }),
};

export interface DashboardSummary {
  totalProjects: number;
  projectsByStatus: Record<string, number>;
  confirmedMetrics: number;
  pendingEvidence: number;
  activeSessions: number;
  unreadMessages: number;
  pendingMedia: number;
  rejectedMedia: number;
  publishedPosts: number;
  draftPosts: number;
  failedNotifications: number;
  activeCvConfigured: boolean;
  activePortraitConfigured: boolean;
  recentAuditEvents: { id: string; action: string; createdAt: string; resource?: string | null }[];
  lastSuccessfulLoginAt: string | null;
  recentFailedLogins24h: number;
}

export const dashboard = {
  summary: () => apiFetch<DashboardSummary>('/admin/dashboard'),
};
