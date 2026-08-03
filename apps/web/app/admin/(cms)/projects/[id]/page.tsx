import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvidenceEditor } from '@/components/EvidenceEditor';
import { FindingsEditor } from '@/components/FindingsEditor';
import { MetricsEditor } from '@/components/MetricsEditor';
import { ProjectForm } from '@/components/ProjectForm';
import { adminServer } from '@/lib/admin-api.server';

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await adminServer.getProject(id);
  if (!project) notFound();

  return (
    <main id="main">
      <p className="eyebrow">Admin / Projects / Edit</p>
      <h1>{project.title}</h1>
      <p>
        <Link href={`/admin/projects/${project.id}/preview`}>PREVIEW DRAFT</Link>
      </p>
      <ProjectForm mode="edit" project={project} />
      <MetricsEditor projectId={project.id} initial={project.metrics ?? []} />
      <FindingsEditor projectId={project.id} initial={project.findings ?? []} />
      <EvidenceEditor projectId={project.id} initial={project.evidence ?? []} />
    </main>
  );
}
