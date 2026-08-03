import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({ gfm: true });

const ALLOWED_TAGS = [
  'p',
  'a',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h2',
  'h3',
  'h4',
  'img',
  'br',
  'hr',
];

/** Field Notes bodies are stored as plain Markdown (the API rejects raw HTML at write time —
 * see `apps/api/src/posts/markdown-safety.ts`). This is the read-time half of that safety
 * design: Markdown -> HTML via `marked` (no raw-HTML passthrough), then sanitized down to a
 * fixed allowlist as defense in depth, shared by the public article page and the admin preview
 * so there is exactly one rendering path to keep safe. */
export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false });
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'rel', 'target'], img: ['src', 'alt', 'width', 'height'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}
