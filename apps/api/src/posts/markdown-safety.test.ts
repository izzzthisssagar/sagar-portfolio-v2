import { describe, expect, it } from 'vitest';
import { containsDisallowedMarkup } from './markdown-safety';

describe('containsDisallowedMarkup', () => {
  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'Text with an inline <strong>tag</strong>.',
    '<iframe src="evil"></iframe>',
  ])('rejects %s', (body) => expect(containsDisallowedMarkup(body)).toBe(true));

  it.each([
    '# Heading\n\nA plain paragraph with *emphasis* and a [link](https://example.com).',
    'Comparison: 2 < 3 and 5 > 4',
  ])('allows plain Markdown %s', (body) => expect(containsDisallowedMarkup(body)).toBe(false));
});
