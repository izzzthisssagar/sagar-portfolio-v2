import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminServer } from '@/lib/admin-api.server';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

const SECTIONS: {
  key:
    | 'overview'
    | 'context'
    | 'responsibilities'
    | 'systemMap'
    | 'testStrategy'
    | 'fixAndRetest'
    | 'outcome'
    | 'lessons';
  label: string;
}[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'context', label: 'Context' },
  { key: 'responsibilities', label: 'Responsibilities' },
  { key: 'systemMap', label: 'System map' },
  { key: 'testStrategy', label: 'Test strategy' },
  { key: 'fixAndRetest', label: 'Fix and retest' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'lessons', label: 'Lessons and future improvements' },
];

export default async function ProjectPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await adminServer.getProject(id);
  if (!project) notFound();

  return (
    <main id="main" className="page-shell">
      <div className="container">
        <p className="draft-preview-banner" role="status">
          DRAFT PREVIEW — status: {project.status}. Not publicly accessible.
        </p>
        <article>
          <p className="eyebrow">Preview</p>
          <h1 className="display">{project.title}</h1>
          <p className="lede">{project.summary}</p>

          {project.metrics && project.metrics.length > 0 && (
            <div className="metrics">
              {project.metrics.map((metric) => (
                <div className="metric" key={metric.id}>
                  <strong>{metric.value}</strong>
                  <span>
                    {metric.label} ({metric.evidence})
                  </span>
                </div>
              ))}
            </div>
          )}

          {SECTIONS.filter(({ key }) => project[key]).map(({ key, label }) => (
            <section className="section" key={key}>
              <h2>{label}</h2>
              <p>{project[key]}</p>
            </section>
          ))}

          {project.findings && project.findings.length > 0 && (
            <section className="section">
              <h2>Findings</h2>
              <ul>
                {project.findings.map((finding) => (
                  <li key={finding.id}>
                    <strong>{finding.title}</strong> ({finding.severity ?? 'unrated'},{' '}
                    {finding.evidenceStatus}) — {finding.summary}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </div>
    </main>
  );
}
