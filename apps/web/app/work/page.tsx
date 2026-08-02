import { ProjectIndex } from '@/components/HomeSections';
import { getPublishedProjects } from '@/lib/public-content.server';

export default async function WorkPage() {
  const projects = await getPublishedProjects();
  return (
    <main id="main">
      <ProjectIndex projects={projects} />
    </main>
  );
}
