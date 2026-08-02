import { describe, expect, it } from 'vitest';
import { validateForPublication } from './publication-rules';

const base = {
  title: 'QA Mastery',
  slug: 'qa-mastery',
  summary: 'A sufficiently long summary describing the project.',
  overview: 'An overview of the project.',
  responsibilities: null,
  testStrategy: null,
};

describe('publication readiness rules', () => {
  it('requires an overview', () => {
    expect(validateForPublication({ ...base, overview: null })).toContain('Overview is required.');
  });
  it('requires responsibilities or test strategy', () => {
    expect(validateForPublication(base)).toContain(
      'At least one of responsibilities or test strategy is required.',
    );
  });
  it('passes when responsibilities is supplied', () => {
    expect(validateForPublication({ ...base, responsibilities: 'Led QA strategy.' })).toEqual([]);
  });
  it('passes when only test strategy is supplied', () => {
    expect(validateForPublication({ ...base, testStrategy: 'Exploratory + automated.' })).toEqual(
      [],
    );
  });
});
