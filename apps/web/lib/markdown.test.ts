import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, links, and emphasis to allowlisted tags', () => {
    const html = renderMarkdown('## Heading\n\nSome *text* with a [link](https://example.com).');
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<em>text</em>');
    expect(html).toContain('href="https://example.com"');
  });

  it('strips a script tag embedded in the Markdown source', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips event-handler attributes from an embedded raw image tag', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('onerror');
  });

  it('adds rel=noopener to links', () => {
    const html = renderMarkdown('[link](https://example.com)');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
