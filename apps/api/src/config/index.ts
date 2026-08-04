import { apiEnvSchema, adminProvisioningSchema, type ApiEnv } from './schema';

export type { ApiEnv };

export interface ConfigResult {
  ok: boolean;
  config: ApiEnv | null;
  errors: string[];
}

/** Requirements that only apply when `NODE_ENV=production` — every other environment (including
 * CI, which sets `NODE_ENV` to something other than `production`) may fall back to the
 * development-friendly local/capture defaults. Kept as plain checks rather than zod refinements
 * because they read across the composed schema's categories (core.NODE_ENV against media/contact
 * driver selection), which a single flat superRefine expresses more clearly than a cross-object
 * zod intersection would.
 *
 * Takes the *raw* env alongside the parsed one specifically for WEB_URL/API_URL: both have a
 * schema-level default (WEB_URL) or stay optional (API_URL) so development/test/CI need not set
 * them, which means the parsed value alone can never tell "the user explicitly set this" apart
 * from "the schema silently filled it in" — checking `rawEnv.WEB_URL`/`rawEnv.API_URL` directly
 * is the only way to fail closed on a production deploy that never set them at all, rather than
 * quietly booting against `http://localhost:3000` or with Host enforcement disabled. */
function productionOnlyErrors(env: ApiEnv, rawEnv: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  if (!env.MEDIA_STORAGE_DRIVER) {
    errors.push(
      'MEDIA_STORAGE_DRIVER: is required in production (must be "s3" — refusing to fall back to local disk storage)',
    );
  } else if (env.MEDIA_STORAGE_DRIVER !== 's3') {
    errors.push('MEDIA_STORAGE_DRIVER: must be "s3" in production');
  }
  if (!env.CONTACT_NOTIFICATION_DRIVER) {
    errors.push(
      'CONTACT_NOTIFICATION_DRIVER: is required in production (must be "smtp" — refusing to fall back to the capture adapter)',
    );
  } else if (env.CONTACT_NOTIFICATION_DRIVER !== 'smtp') {
    errors.push('CONTACT_NOTIFICATION_DRIVER: must be "smtp" in production');
  }
  if (!rawEnv.WEB_URL?.trim()) {
    errors.push(
      'WEB_URL: is required in production — refusing to silently default to http://localhost:3000, ' +
        'which is also the expected browser Origin for CSRF enforcement (see auth/csrf.guard.ts)',
    );
  }
  if (!rawEnv.API_URL?.trim()) {
    errors.push(
      'API_URL: is required in production — used as the expected Host for CSRF enforcement ' +
        '(see auth/csrf.guard.ts); the API must not start in production without it',
    );
  }
  return errors;
}

function formatZodErrors(issues: { path: PropertyKey[]; message: string }[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/** Never throws — every caller decides how to react to `ok: false` (the real bootstrap fails
 * closed and refuses to start; `pnpm config:check` prints the errors and exits non-zero without
 * starting anything). Secret values are never included in `errors` — only the field name and a
 * static validation message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const parsed = apiEnvSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, config: null, errors: formatZodErrors(parsed.error.issues) };
  }
  const productionErrors = productionOnlyErrors(parsed.data, env);
  if (productionErrors.length) {
    return { ok: false, config: null, errors: productionErrors };
  }
  return { ok: true, config: parsed.data, errors: [] };
}

/** Used by the real API bootstrap (never by tests, which construct their own fixtures) — fails
 * closed with every validation error listed in one message, rather than starting with partial or
 * guessed configuration. */
export function loadConfigOrThrow(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = loadConfig(env);
  if (!result.ok || !result.config) {
    throw new Error(
      `Invalid runtime configuration — refusing to start:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return result.config;
}

let cached: ApiEnv | null = null;

/** Memoized against the process's own `process.env` — computed once, on first access, for the
 * lifetime of the process. Never used by tests (they call `loadConfig`/`loadConfigOrThrow`
 * directly with their own fixture `env` objects, since a memoized singleton keyed to the real
 * `process.env` would leak state across test cases). */
export function getConfig(): ApiEnv {
  cached ??= loadConfigOrThrow();
  return cached;
}

/** Test-only escape hatch to reset the memoized singleton between cases that mutate
 * `process.env` directly instead of passing a fixture. */
export function resetConfigCache(): void {
  cached = null;
}

export interface AdminProvisioningConfigResult {
  ok: boolean;
  email: string | null;
  password: string | null;
  errors: string[];
}

/** Separate from `loadConfig` — `ADMIN_EMAIL`/`ADMIN_PASSWORD` are only required by the
 * `admin:create` CLI, never by the API server itself. */
export function loadAdminProvisioningConfig(
  env: NodeJS.ProcessEnv = process.env,
): AdminProvisioningConfigResult {
  const parsed = adminProvisioningSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, email: null, password: null, errors: formatZodErrors(parsed.error.issues) };
  }
  const errors: string[] = [];
  if (!parsed.data.ADMIN_EMAIL) errors.push('ADMIN_EMAIL: is required');
  if (!parsed.data.ADMIN_PASSWORD) errors.push('ADMIN_PASSWORD: is required');
  if (errors.length) return { ok: false, email: null, password: null, errors };
  return {
    ok: true,
    email: parsed.data.ADMIN_EMAIL!,
    password: parsed.data.ADMIN_PASSWORD!,
    errors: [],
  };
}
