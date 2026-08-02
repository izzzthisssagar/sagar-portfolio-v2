import { projects } from '@/lib/content';
export default function Projects() {
  return (
    <main id="main">
      <p className="eyebrow">Admin / Projects</p>
      <h1>Projects</h1>
      <ol>
        {projects.map((p) => (
          <li key={p.id}>
            {p.title} — {p.status}
          </li>
        ))}
      </ol>
      <button className="button" type="button" aria-disabled="true">
        NEW PROJECT — AUTH REQUIRED
      </button>
    </main>
  );
}
