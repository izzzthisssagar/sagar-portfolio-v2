import type { Metadata } from 'next';
import { ProjectIndex } from '@/components/HomeSections';
import { getPublishedProjects } from '@/lib/public-content.server';

// Forced dynamic (not just implicit from a dynamic API call, since this page doesn't use one
// itself): proxy.ts sets a fresh per-request CSP nonce on every request via a request header,
// which Next.js only applies to its own framework-injected inline scripts (hydration bootstrap,
// RSC payload) when the page is dynamically rendered — a statically prerendered page bakes in
// whatever nonce was available at build time, which then never matches the real per-request CSP
// header, and every browser that enforces CSP blocks those scripts outright. Found by actually
// building a production bundle and auditing it with Lighthouse (its Chrome instance enforces CSP
// for real) — apps/web/app/work/[slug]/page.tsx has the fuller explanation and the same fix
// applied via removing generateStaticParams there instead, since that page already needs
// headers() directly. The underlying data fetch still caches via `next: { revalidate: 60 }`
// (public-content.server.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Work',
  description: 'Case studies in interfaces, business rules, APIs, security, and performance.',
  alternates: { canonical: '/work' },
};

export default async function WorkPage() {
  const projects = await getPublishedProjects();
  return (
    <main id="main">
      <ProjectIndex projects={projects} />
    </main>
  );
}
