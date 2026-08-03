import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { adminServer } from '@/lib/admin-api.server';
import { verifyAdminAccessToken } from '@/lib/admin-auth.server';
import { safeReturnTo } from '@/lib/safe-redirect';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const claims = await verifyAdminAccessToken((await cookies()).get('portfolio_access')?.value);
  // Redirect away from the login page only when the access cookie is both a
  // well-formed, correctly signed JWT *and* still live in the database — a
  // JWT-only check here would bounce a visitor with a database-revoked
  // cookie (logout-all, reuse detection) straight to the dashboard, which
  // would immediately bounce them back to login (it does the same live
  // check) — a redirect loop. Checking both here, the same way the
  // dashboard does, means neither page ever redirects to the other for a
  // dead session: login stays put and renders the form instead.
  if (claims && (await adminServer.session())) redirect(safeReturnTo(returnTo));

  return (
    <main id="main" className="login">
      <p className="eyebrow">Single administrator</p>
      <h1>Sign in</h1>
      <LoginForm returnTo={returnTo ?? ''} />
    </main>
  );
}
