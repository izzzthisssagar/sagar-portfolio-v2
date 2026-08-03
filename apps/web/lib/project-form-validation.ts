export interface ProjectFormValues {
  title: string;
  slug: string;
  summary: string;
  overview: string;
  context: string;
  responsibilities: string;
  systemMap: string;
  testStrategy: string;
  fixAndRetest: string;
  outcome: string;
  lessons: string;
  liveUrl: string;
  githubUrl: string;
  labels: string;
  sceneState: string;
  order: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PATTERN = /^https?:\/\/.+/i;

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>;

export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};

  if (values.title.trim().length < 2 || values.title.length > 120) {
    errors.title = 'Title must be between 2 and 120 characters.';
  }
  if (!SLUG_PATTERN.test(values.slug)) {
    errors.slug = 'Slug must be lowercase letters, numbers, and single hyphens (e.g. qa-mastery).';
  }
  if (values.summary.trim().length < 20 || values.summary.length > 500) {
    errors.summary = 'Summary must be between 20 and 500 characters.';
  }
  if (values.liveUrl && !URL_PATTERN.test(values.liveUrl)) {
    errors.liveUrl = 'Live URL must start with http:// or https://.';
  }
  if (values.githubUrl && !URL_PATTERN.test(values.githubUrl)) {
    errors.githubUrl = 'GitHub URL must start with http:// or https://.';
  }
  const order = Number(values.order);
  if (!Number.isInteger(order) || order < 0 || order > 10_000) {
    errors.order = 'Display order must be a whole number between 0 and 10000.';
  }
  if (!values.sceneState) {
    errors.sceneState = 'Choose a scene state.';
  }

  return errors;
}
