import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getNonce } from '@/lib/nonce.server';
import { getPublishedProjectBySlug } from '@/lib/public-content.server';
import { creativeWorkJsonLd, JsonLd } from '@/lib/seo';

// Deliberately no generateStaticParams here: this page reads the per-request CSP nonce
// (getNonce() -> headers()) so JsonLd's inline <script> matches the response's own
// Content-Security-Policy — a real per-request value, not a build-time-baked one reused across
// every visitor. Next.js does not allow combining a dynamic API like headers() with static
// generation for the same route (it throws DYNAMIC_SERVER_USAGE at request time rather than
// silently caching a stale/shared nonce) — found by actually running a production build and
// requesting this route, which apps/web's dev-server-backed e2e/unit tests never exercise. The
// underlying data fetch (getPublishedProjectBySlug) still caches via `next: { revalidate: 60 }`
// (public-content.server.ts), so this only trades pre-built HTML for a fast per-request render
// over already-cached data — not a full return to uncached rendering.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = await getPublishedProjectBySlug(slug);
  if (!project) return {};
  const canonical = `/work/${slug}`;
  return {
    title: project.title,
    description: project.summary,
    alternates: { canonical },
    openGraph: {
      title: project.title,
      description: project.summary,
      url: canonical,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: project.title,
      description: project.summary,
    },
  };
}

const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const evidenceFileUrl = (mediaId: string) => `${PUBLIC_API_URL}/media/${mediaId}/file`;

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'context', label: 'Context' },
  { key: 'responsibilities', label: 'Responsibilities' },
  { key: 'systemMap', label: 'System map' },
  { key: 'testStrategy', label: 'Test strategy' },
  { key: 'fixAndRetest', label: 'Fix and retest' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'lessons', label: 'Lessons and future improvements' },
] as const;

export default async function CaseStudy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [project, nonce] = await Promise.all([getPublishedProjectBySlug(slug), getNonce()]);
  if (!project) notFound();

  return (
    <main id="main" className="page-shell">
      <JsonLd data={creativeWorkJsonLd(project)} nonce={nonce} />
      <article className="container">
        <p className="eyebrow">Project / {project.status}</p>
        <h1 className="display">{project.title}</h1>
        <p className="lede">{project.summary}</p>

        {project.metrics.length > 0 && (
          <div className="metrics">
            {project.metrics.map((metric) => (
              <div className="metric" key={metric.label}>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        )}

        {(project.liveUrl || project.githubUrl) && (
          <div className="actions">
            {project.liveUrl && (
              <a className="button primary" href={project.liveUrl}>
                VIEW LIVE
              </a>
            )}
            {project.githubUrl && (
              <a className="button" href={project.githubUrl}>
                GITHUB
              </a>
            )}
          </div>
        )}

        {project.labels && project.labels.length > 0 && <p>{project.labels.join(' / ')}</p>}

        {SECTIONS.filter(({ key }) => project[key]).map(({ key, label }) => (
          <section className="section" key={key}>
            <h2>{label}</h2>
            <p>{project[key]}</p>
          </section>
        ))}

        {project.findings.length > 0 && (
          <section className="section">
            <h2>Findings</h2>
            <ul>
              {project.findings.map((finding) => (
                <li key={finding.title}>
                  <strong>{finding.title}</strong> ({finding.severity ?? 'unrated'}, evidence:{' '}
                  {finding.evidenceStatus}) — {finding.summary}
                </li>
              ))}
            </ul>
          </section>
        )}

        {project.evidence && project.evidence.length > 0 && (
          <section className="section">
            <h2>Evidence</h2>
            <div className="evidence-grid">
              {project.evidence.map((row) => (
                <figure className="evidence-item" key={row.mediaId}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- public, approved-only asset served from the API, not a Next-optimizable local/remote source */}
                  <img src={evidenceFileUrl(row.mediaId!)} alt={row.altText ?? row.title ?? ''} />
                  {row.caption && <figcaption>{row.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  );
}
