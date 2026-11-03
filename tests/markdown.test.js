'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('markdown renderer escapes raw HTML and blocks javascript links', async () => {
  const { renderMarkdown } = await import('../lib/markdown.js');
  const html = renderMarkdown('<script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n[ok](https://example.com)');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('markdown renderer supports headings, tables and fenced code', async () => {
  const { renderMarkdownWithToc } = await import('../lib/markdown.js');
  const { html, headings } = renderMarkdownWithToc('# Title\n\n## Section\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```bash\necho hi\n```');
  assert.equal(headings.length, 2);
  assert.equal(headings[0].id, 'title');
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-bash"/);
});

test('markdown headings get unique ids for duplicates', async () => {
  const { extractHeadings } = await import('../lib/markdown.js');
  const headings = extractHeadings('# Same\n\n# Same');
  assert.deepEqual(headings.map((h) => h.id), ['same', 'same-2']);
});
