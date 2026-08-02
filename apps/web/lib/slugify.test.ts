import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('QA Mastery')).toBe('qa-mastery');
  });
  it('collapses non-alphanumeric runs', () => {
    expect(slugify('Numazu Halal Food!!')).toBe('numazu-halal-food');
  });
  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --Edge Case--  ')).toBe('edge-case');
  });
});
