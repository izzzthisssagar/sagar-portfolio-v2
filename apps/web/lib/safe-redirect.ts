const DEFAULT_RETURN_TO = '/admin/dashboard';

/**
 * Only ever returns an internal /admin/* path. Rejects protocol-relative
 * URLs (//evil.example), absolute URLs, and anything outside /admin — the
 * login page's `returnTo` is attacker-controlled query input.
 */
export function safeReturnTo(value: string | undefined | null): string {
  if (!value) return DEFAULT_RETURN_TO;
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_RETURN_TO;
  if (value.includes('://')) return DEFAULT_RETURN_TO;
  if (!(value === '/admin' || value.startsWith('/admin/'))) return DEFAULT_RETURN_TO;
  if (value.startsWith('/admin/login')) return DEFAULT_RETURN_TO;
  return value;
}
