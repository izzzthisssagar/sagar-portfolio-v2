export interface PostFormValues {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  tags: string;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  displayOrder: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PATTERN = /^https?:\/\/.+/i;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

export type PostFormErrors = Partial<Record<keyof PostFormValues, string>>;

export function validatePostForm(values: PostFormValues): PostFormErrors {
  const errors: PostFormErrors = {};

  if (values.title.trim().length < 2 || values.title.length > 160) {
    errors.title = 'Title must be between 2 and 160 characters.';
  }
  if (!SLUG_PATTERN.test(values.slug)) {
    errors.slug = 'Slug must be lowercase letters, numbers, and single hyphens.';
  }
  if (values.body && HTML_TAG.test(values.body)) {
    errors.body = 'Body must be plain Markdown — raw HTML tags are not allowed.';
  }
  if (values.canonicalUrl && !URL_PATTERN.test(values.canonicalUrl)) {
    errors.canonicalUrl = 'Canonical URL must start with http:// or https://.';
  }
  const order = Number(values.displayOrder);
  if (!Number.isInteger(order) || order < 0 || order > 10_000) {
    errors.displayOrder = 'Display order must be a whole number between 0 and 10000.';
  }

  return errors;
}
