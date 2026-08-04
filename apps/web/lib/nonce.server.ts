import 'server-only';
import { headers } from 'next/headers';

/** The per-request CSP nonce proxy.ts generated and forwarded as the `x-nonce` request header —
 * pass this to `JsonLd` (lib/seo.tsx) so its inline script matches the same nonce the
 * `Content-Security-Policy: script-src` response header allows. */
export async function getNonce(): Promise<string | undefined> {
  return (await headers()).get('x-nonce') ?? undefined;
}
