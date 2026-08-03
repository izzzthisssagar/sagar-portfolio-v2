import 'server-only';
import { jwtVerify, type JWTPayload } from 'jose';

export interface AdminAccessClaims extends JWTPayload {
  sub: string;
  role: 'admin';
  tokenVersion: number;
}

function verificationConfig() {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  const issuer = process.env.ACCESS_TOKEN_ISSUER;
  const audience = process.env.ACCESS_TOKEN_AUDIENCE;
  if (!secret || secret.length < 32 || secret.startsWith('replace-') || !issuer || !audience) {
    return null;
  }
  return { key: new TextEncoder().encode(secret), issuer, audience };
}

export async function verifyAdminAccessToken(token: string | undefined) {
  const config = verificationConfig();
  if (!token || !config) return null;
  try {
    const { payload } = await jwtVerify(token, config.key, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
    if (
      typeof payload.exp !== 'number' ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.role !== 'admin' ||
      typeof payload.tokenVersion !== 'number'
    )
      return null;
    return payload as AdminAccessClaims;
  } catch {
    return null;
  }
}
