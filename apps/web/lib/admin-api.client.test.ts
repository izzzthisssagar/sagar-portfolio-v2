import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}`;
}

describe('admin-api.client — refresh-and-retry on an expired access token', () => {
  beforeEach(() => {
    vi.resetModules();
    setCookie('portfolio_csrf', 'csrf-before-refresh');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes once and retries the original request exactly once, preserving method/body', async () => {
    const { projects } = await import('./admin-api.client');
    let projectCalls = 0;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) {
        setCookie('portfolio_csrf', 'csrf-after-refresh');
        return jsonResponse(200, { data: { email: 'admin@example.invalid' } });
      }
      if (url.includes('/admin/projects/p1')) {
        projectCalls += 1;
        if (projectCalls === 1) {
          return jsonResponse(401, { error: { code: 'HTTP_401', message: 'expired' } });
        }
        expect(init?.method).toBe('PATCH');
        expect(init?.body).toBe(JSON.stringify({ title: 'New title' }));
        expect((init?.headers as Headers).get('X-CSRF-Token')).toBe('csrf-after-refresh');
        return jsonResponse(200, { data: { id: 'p1', title: 'New title' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await projects.update('p1', { title: 'New title' });

    expect(result).toEqual({ id: 'p1', title: 'New title' });
    expect(projectCalls).toBe(2);
    const refreshCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('coalesces several concurrent expired requests into a single refresh call', async () => {
    const { projects } = await import('./admin-api.client');
    let refreshCalls = 0;
    const attemptsByPath = new Map<string, number>();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        setCookie('portfolio_csrf', 'csrf-after-refresh');
        // Resolve on a microtask delay so all three callers' 401s land
        // before any of them observes the refresh as already resolved.
        await Promise.resolve();
        return jsonResponse(200, { data: { email: 'admin@example.invalid' } });
      }
      const attempt = (attemptsByPath.get(url) ?? 0) + 1;
      attemptsByPath.set(url, attempt);
      if (attempt === 1) return jsonResponse(401, { error: { code: 'HTTP_401' } });
      return jsonResponse(200, { data: { id: url } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    await Promise.all([projects.get('a'), projects.get('b'), projects.get('c')]);

    expect(refreshCalls).toBe(1);
  });

  it('redirects to login and does not retry forever when the refresh itself fails', async () => {
    const { projects, ApiError } = await import('./admin-api.client');
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/auth/refresh')) return jsonResponse(401, { error: {} });
      return jsonResponse(401, { error: { code: 'HTTP_401', message: 'expired' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    // jsdom's window.location.assign is non-configurable, so it can't be
    // spied on directly — stub the whole `location` global instead.
    const assignSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign: assignSpy });

    await expect(projects.get('p1')).rejects.toBeInstanceOf(ApiError);

    const refreshCalls = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    const projectCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/p1'));
    expect(projectCalls).toHaveLength(1);
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(assignSpy.mock.calls[0]?.[0]).toContain('/admin/login');
  });

  it('never retries a failed login as if it were an expired session', async () => {
    const { auth, ApiError } = await import('./admin-api.client');
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/auth/login')) {
        return jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'nope' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(auth.login('a@b.com', 'wrong-password')).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
