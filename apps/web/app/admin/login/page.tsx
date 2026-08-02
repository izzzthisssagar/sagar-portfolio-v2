import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { verifyAdminAccessToken } from '@/lib/admin-auth.server';
import { safeReturnTo } from '@/lib/safe-redirect';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const claims = await verifyAdminAccessToken((await cookies()).get('portfolio_access')?.value);
  if (claims) redirect(safeReturnTo(returnTo));

  return (
    <main id="main" className="login">
      <p className="eyebrow">Single administrator</p>
      <h1>Sign in</h1>
      <LoginForm returnTo={returnTo ?? ''} />
    </main>
  );
}
