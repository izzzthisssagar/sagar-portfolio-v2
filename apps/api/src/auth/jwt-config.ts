export interface AccessTokenConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * Single source of truth for access-token signing/verification config.
 * Returns null (never throws) when required production configuration is
 * absent or a placeholder — callers must fail closed on null.
 */
export function loadAccessTokenConfig(): AccessTokenConfig | null {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const issuer = process.env.ACCESS_TOKEN_ISSUER;
  const audience = process.env.ACCESS_TOKEN_AUDIENCE;
  if (
    !secret ||
    secret.length < 32 ||
    secret.startsWith('replace-') ||
    !issuer ||
    !audience
  ) {
    return null;
  }
  return { secret, issuer, audience };
}
