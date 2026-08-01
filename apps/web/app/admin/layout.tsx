import Link from 'next/link';
const links = ['dashboard', 'projects', 'posts', 'linkedin', 'game', 'media', 'settings'];
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <aside className="admin-nav">
        <strong>PRIVATE CMS</strong>
        <nav aria-label="Admin">
          {links.map((x) => (
            <Link key={x} href={`/admin/${x}`}>
              {x.toUpperCase()}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
