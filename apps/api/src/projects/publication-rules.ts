export interface PublishableProject {
  title: string;
  slug: string;
  summary: string;
  overview: string | null;
  responsibilities: string | null;
  testStrategy: string | null;
}

export function validateForPublication(project: PublishableProject): string[] {
  const errors: string[] = [];
  if (!project.title.trim()) errors.push('Title is required.');
  if (!project.slug.trim()) errors.push('Slug is required.');
  if (!project.summary.trim()) errors.push('Summary is required.');
  if (!project.overview?.trim()) errors.push('Overview is required.');
  if (!project.responsibilities?.trim() && !project.testStrategy?.trim()) {
    errors.push('At least one of responsibilities or test strategy is required.');
  }
  return errors;
}
