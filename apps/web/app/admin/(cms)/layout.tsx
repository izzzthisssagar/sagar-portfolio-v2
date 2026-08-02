import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

const links = ['dashboard', 'projects', 'posts', 'linkedin', 'game', 'media', 'settings'];
export default async function AuthenticatedCmsLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get('portfolio_access');
  if (!session?.value) redirect('/admin/login?returnTo=/admin/dashboard');
  return (
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
  );
}
