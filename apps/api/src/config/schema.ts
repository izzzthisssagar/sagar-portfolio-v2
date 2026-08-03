import { z } from 'zod';

const bool = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true'));

const boundedInt = (min: number, max: number, defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return defaultValue;
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        ctx.addIssue({ code: 'custom', message: `must be an integer, got "${v}"` });
        return z.NEVER;
      }
      if (n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `must be between ${min} and ${max}, got ${n}` });
        return z.NEVER;
      }
      return n;
    });

/** A secret must be a real value of reasonable length, never a placeholder someone forgot to
 * replace — `startsWith('replace-')` catches the exact placeholder convention already used in
 * `.env.example` (see jwt-config.ts, the precedent this generalizes). */
const secret = (minLength: number) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !v.startsWith('replace-'), 'is still the placeholder value from .env.example');

const url = () => z.string().trim().url();

export const coreSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().trim().min(1, 'is required').startsWith('postgres', {
    message: 'must be a postgres:// or postgresql:// connection string',
  }),
  WEB_URL: url().default('http://localhost:3000'),
  API_URL: url().optional(),
  PORT: boundedInt(1, 65_535, 4000),
});

export const authSchema = z.object({
  ACCESS_TOKEN_SECRET: secret(32),
  ACCESS_TOKEN_ISSUER: z.string().trim().min(1, 'is required'),
  ACCESS_TOKEN_AUDIENCE: z.string().trim().min(1, 'is required'),
  // Not currently consumed by refresh-token issuance — refresh tokens are opaque, random,
  // database-hashed values (see auth.service.ts), not JWTs. Validated here for forward
  // compatibility and because it's already present across every deployed environment; nothing
  // in the running application reads it today.
  REFRESH_TOKEN_SECRET: secret(32),
  REFRESH_TOKEN_TTL_DAYS: boundedInt(1, 365, 7),
});

/** Only enforced when `provisionAdmin` is actually invoked (the `admin:create` CLI) — never
 * required for the API server itself to boot. */
export const adminProvisioningSchema = z.object({
  ADMIN_EMAIL: z.string().trim().email().optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
});

const mediaDriverSchema = z.enum(['local', 's3']);

export const mediaSchema = z
  .object({
    MEDIA_STORAGE_DRIVER: mediaDriverSchema.optional(),
    MEDIA_STORAGE_LOCAL_PATH: z.string().trim().min(1).optional(),
    MEDIA_STORAGE_ENDPOINT: url().optional(),
    MEDIA_STORAGE_REGION: z.string().trim().min(1).optional(),
    MEDIA_STORAGE_BUCKET: z.string().trim().min(1).optional(),
    MEDIA_STORAGE_ACCESS_KEY: z.string().trim().min(1).optional(),
    MEDIA_STORAGE_SECRET_KEY: z.string().trim().min(1).optional(),
    MEDIA_STORAGE_PUBLIC_BASE_URL: url().optional(),
    MEDIA_MAX_IMAGE_BYTES: boundedInt(1024, 100 * 1024 * 1024, 8 * 1024 * 1024),
    MEDIA_MAX_PDF_BYTES: boundedInt(1024, 200 * 1024 * 1024, 15 * 1024 * 1024),
  })
  .superRefine((v, ctx) => {
    if (v.MEDIA_STORAGE_DRIVER !== 's3') return;
    for (const key of [
      'MEDIA_STORAGE_REGION',
      'MEDIA_STORAGE_BUCKET',
      'MEDIA_STORAGE_ACCESS_KEY',
      'MEDIA_STORAGE_SECRET_KEY',
    ] as const) {
      if (!v[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when MEDIA_STORAGE_DRIVER=s3`,
        });
      }
    }
  });

const contactDriverSchema = z.enum(['capture', 'smtp']);

export const contactSchema = z
  .object({
    CONTACT_NOTIFICATION_DRIVER: contactDriverSchema.optional(),
    CONTACT_NOTIFICATION_TO: z.string().trim().email().optional(),
    SMTP_HOST: z.string().trim().min(1).optional(),
    SMTP_PORT: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65_535) {
          ctx.addIssue({ code: 'custom', message: `must be an integer 1-65535, got "${v}"` });
          return z.NEVER;
        }
        return n;
      }),
    SMTP_SECURE: bool(false),
    SMTP_USERNAME: z.string().trim().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().trim().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.CONTACT_NOTIFICATION_DRIVER !== 'smtp') return;
    for (const key of [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USERNAME',
      'SMTP_PASSWORD',
      'SMTP_FROM',
      'CONTACT_NOTIFICATION_TO',
    ] as const) {
      if (!v[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when CONTACT_NOTIFICATION_DRIVER=smtp`,
        });
      }
    }
  });

/** `TRUST_PROXY` is never inferred — an explicit choice, since the wrong default is a security
 * bug in either direction (trusting an untrusted hop lets a client spoof its own IP via
 * X-Forwarded-For; not trusting a real hop breaks IP-based rate-limiting/hashing behind it).
 * `"false"` (default) matches Express's own default and is correct with no reverse proxy in
 * front. `"1"` means "trust exactly one hop" — the only topology this app documents support for
 * (see docs/security-production.md) — everything else is rejected rather than guessed at. */
export const operationalSchema = z.object({
  RATE_LIMIT_MAX: boundedInt(1, 100_000, 60),
  TRUST_PROXY: z.enum(['false', '1']).default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  SERVICE_NAME: z.string().trim().min(1).default('portfolio-api'),
  RELEASE_SHA: z.string().trim().min(1).default('unknown'),
  HEALTH_INTERNAL_TOKEN: z.string().min(16).optional(),
  SHUTDOWN_GRACE_PERIOD_MS: boundedInt(0, 60_000, 10_000),
});

export const apiEnvSchema = coreSchema
  .and(authSchema)
  .and(mediaSchema)
  .and(contactSchema)
  .and(operationalSchema);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
