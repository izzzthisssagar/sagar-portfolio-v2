import { notFound } from 'next/navigation';
import { caseStudySections, projects } from '@/lib/content';
export function generateStaticParams() {
  return projects.map(({ slug }) => ({ slug }));
}
export default async function CaseStudy({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) notFound();
  return (
    <main id="main" className="page-shell">
      <article className="container">
        <p className="eyebrow">
          Project {project.id} / {project.status}
        </p>
        <h1 className="display">{project.title}</h1>
        <p className="lede">{project.summary}</p>
        {project.slug === 'numazu-halal-food' && (
          <section>
            <h2>Expected / Actual / Fixed</h2>
            <p>
              MRP − discount + shipping + VAT = total. Known issue: the product discount was applied
              twice. Published evidence remains pending.
            </p>
          </section>
        )}
        {project.slug === 'api-security-testing' && (
          <section>
            <h2>Authorization gateway</h2>
            <p>
              Valid → unauthenticated → unauthorized cross-user → ownership failure → corrected
              ownership enforcement.
            </p>
          </section>
        )}
        {project.slug === 'performance-testing' && (
          <section>
            <h2>Latency distribution</h2>
            <p>
              P50 / P95 / P99 / long-tail latency / bottleneck indication. Results are not populated
              until measured evidence is supplied.
            </p>
          </section>
        )}
        {project.slug === 'automation-testing' && (
          <section>
            <h2>Automation trace</h2>
            <p>
              Open → Locate → Act → Assert → Report. Failure evidence branches to screenshot,
              console, stack trace, and defect record.
            </p>
          </section>
        )}
        {caseStudySections.map((section) => (
          <section className="section" key={section}>
            <h2>{section}</h2>
            <p>
              {project.status === 'draft'
                ? 'Draft structure — factual evidence and approved media are pending.'
                : 'Case-study content is under active development.'}
            </p>
          </section>
        ))}
      </article>
    </main>
  );
}
