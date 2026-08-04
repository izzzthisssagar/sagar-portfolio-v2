import { z } from 'zod';

/** Build-time/runtime configuration for the web app — separate from the API's
 * (apps/api/src/config), since these are two different processes with two different env
 * surfaces. `NEXT_PUBLIC_*` variables are inlined into the browser bundle at build time by
 * Next.js itself; never put a secret behind one. */
const webEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NEXT_PUBLIC_API_URL: z.string().trim().url().default('http://localhost:4000/api/v1'),
    WEB_URL: z.string().trim().url().default('http://localhost:3000'),
    PUBLIC_SITE_URL: z.string().trim().url().optional(),
    API_URL: z.string().trim().url().optional(),
    ALLOW_STATIC_CONTENT_FALLBACK: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && !v.PUBLIC_SITE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_SITE_URL'],
        message:
          'is required in production (page metadata, JSON-LD, sitemap, and robots all need a real origin)',
      });
    }
    if (v.NODE_ENV === 'production' && v.ALLOW_STATIC_CONTENT_FALLBACK) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_STATIC_CONTENT_FALLBACK'],
        message:
          'must not be "true" in production — an API outage must fail visibly, not silently render stale fallback content',
      });
    }
  });

export type WebEnv = z.infer<typeof webEnvSchema>;

export interface WebConfigResult {
  ok: boolean;
  config: WebEnv | null;
  errors: string[];
}

export function loadWebConfig(
  env: Record<string, string | undefined> = process.env,
): WebConfigResult {
  const parsed = webEnvSchema.safeParse(env);
  if (!parsed.success) {
    return {
      ok: false,
      config: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, config: parsed.data, errors: [] };
}
