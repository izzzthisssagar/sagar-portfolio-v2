import { describe, expect, it } from 'vitest';
import { validateProjectForm, type ProjectFormValues } from './project-form-validation';

const valid: ProjectFormValues = {
  title: 'QA Mastery',
  slug: 'qa-mastery',
  summary: 'A sufficiently long and factual project summary.',
  overview: '',
  context: '',
  responsibilities: '',
  systemMap: '',
  testStrategy: '',
  fixAndRetest: '',
  outcome: '',
  lessons: '',
  liveUrl: '',
  githubUrl: '',
  labels: '',
  sceneState: 'mastery',
  order: '1',
};

describe('validateProjectForm', () => {
  it('accepts a fully valid form', () => {
    expect(validateProjectForm(valid)).toEqual({});
  });
  it('rejects a slug with spaces or uppercase', () => {
    expect(validateProjectForm({ ...valid, slug: 'QA Mastery' }).slug).toBeTruthy();
  });
  it('rejects a summary that is too short', () => {
    expect(validateProjectForm({ ...valid, summary: 'too short' }).summary).toBeTruthy();
  });
  it('rejects a non-numeric order', () => {
    expect(validateProjectForm({ ...valid, order: 'abc' }).order).toBeTruthy();
  });
  it('rejects a live URL without a protocol', () => {
    expect(validateProjectForm({ ...valid, liveUrl: 'example.com' }).liveUrl).toBeTruthy();
  });
  it('accepts an empty optional URL', () => {
    expect(validateProjectForm({ ...valid, liveUrl: '' }).liveUrl).toBeUndefined();
  });
});
