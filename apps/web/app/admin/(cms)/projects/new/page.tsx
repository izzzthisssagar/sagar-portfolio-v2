import { ProjectForm } from '@/components/ProjectForm';

export default function NewProjectPage() {
  return (
    <main id="main">
      <p className="eyebrow">Admin / Projects / New</p>
      <h1>New project</h1>
      <ProjectForm mode="create" />
    </main>
  );
}
