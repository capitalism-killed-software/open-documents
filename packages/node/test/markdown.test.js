import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml } from '../src/index.js';

const sample = `# Release notes

Some **bold** text and a [link](https://example.com).

| Item | Price |
|------|-------|
| Tea  | 3.50  |

\`\`\`js
const x = 1;
\`\`\`
`;

test('markdown becomes a full page with a print style', () => {
  const html = markdownToHtml(sample);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Release notes<\/title>/);
  assert.match(html, /<h1>Release notes<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<table>[\s\S]*<td>Tea<\/td>/);
  assert.match(html, /<code class="language-js">const x = 1;/);
  assert.match(html, /@page/);
});

test('raw html is shown as text unless allowed', () => {
  const md = 'Hi <script>alert(1)</script> <b>there</b>';
  assert.match(markdownToHtml(md), /&lt;script&gt;/);
  assert.doesNotMatch(markdownToHtml(md), /<script>/);
  assert.match(markdownToHtml(md, { allowHtml: true }), /<b>there<\/b>/);
});

test('titles and styles can be set; titles are escaped', () => {
  const html = markdownToHtml('no heading', { title: 'A <b> title', css: 'p { color: red }' });
  assert.match(html, /<title>A &lt;b&gt; title<\/title>/);
  assert.match(html, /<style>p \{ color: red \}<\/style>/);
  assert.match(markdownToHtml('plain'), /<title>Document<\/title>/);
  assert.throws(() => markdownToHtml(/** @type {any} */ (5)), TypeError);
});
