import { describe, expect, it } from 'vitest';
import { validatePostForm, type PostFormValues } from './post-form-validation';

const valid: PostFormValues = {
  title: 'A valid title',
  slug: 'a-valid-title',
  excerpt: 'An excerpt.',
  body: 'Some *Markdown* body content.',
  tags: 'testing, qa',
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  displayOrder: '0',
};

describe('validatePostForm', () => {
  it('accepts a fully valid form', () => {
    expect(validatePostForm(valid)).toEqual({});
  });

  it('rejects a slug with uppercase or spaces', () => {
    expect(validatePostForm({ ...valid, slug: 'Not A Slug' }).slug).toBeDefined();
  });

  it('rejects a body containing raw HTML', () => {
    expect(validatePostForm({ ...valid, body: '<script>alert(1)</script>' }).body).toBeDefined();
  });

  it('rejects a canonical URL without a scheme', () => {
    expect(validatePostForm({ ...valid, canonicalUrl: 'example.com' }).canonicalUrl).toBeDefined();
  });

  it('rejects a negative display order', () => {
    expect(validatePostForm({ ...valid, displayOrder: '-1' }).displayOrder).toBeDefined();
  });
});
