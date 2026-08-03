/** Field Notes bodies are plain Markdown, never Markdown-with-HTML-escape-hatches — this rejects
 * any HTML tag in the source so a browser rich-text editor's raw output (or a hand-crafted
 * `<script>`/`<iframe>`) can never be stored, regardless of what renders it later. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/;

export function containsDisallowedMarkup(body: string): boolean {
  return HTML_TAG.test(body);
}
