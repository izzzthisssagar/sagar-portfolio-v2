import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AdminTopBar } from '@/components/AdminTopBar';
import { adminServer } from '@/lib/admin-api.server';
import { verifyAdminAccessToken } from '@/lib/admin-auth.server';

const links = [
  'dashboard',
  'projects',
  'posts',
  'linkedin',
  'game',
  'media',
  'messages',
  'settings',
];
export default async function AuthenticatedCmsLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get('portfolio_access');
  const claims = await verifyAdminAccessToken(session?.value);
  if (!claims) redirect('/admin/login?returnTo=/admin/dashboard');
  // The JWT can be well-formed, correctly signed, and unexpired while still
  // being dead — logout-all or reuse detection bumps AdminUser.tokenVersion,
  // which this edge check has no way to see (no DB access here). The live
  // API call is the actual authority: JwtAuthGuard rejects a stale
  // tokenVersion, and a rejected /auth/session means this admin's access
  // was revoked in the database. The CMS shell — including its navigation —
  // must never render on a rejected session.
  const sessionInfo = await adminServer.session();
  if (!sessionInfo) redirect('/admin/login?returnTo=/admin/dashboard');
  return (
    <div>
      <AdminTopBar email={sessionInfo?.admin.email ?? ''} />
      <div className="admin-shell">
        <aside className="admin-nav">
          <strong>PRIVATE CMS</strong>
          <nav aria-label="Admin">
            {links.map((link) => (
              <Link key={link} href={`/admin/${link}`}>
                {link.toUpperCase()}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="admin-main">{children}</div>
      </div>
    </div>
  );
}
