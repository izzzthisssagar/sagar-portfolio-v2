import type { Metadata } from 'next';
import { ProjectIndex } from '@/components/HomeSections';
import { getPublishedProjects } from '@/lib/public-content.server';

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
