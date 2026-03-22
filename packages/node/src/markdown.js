// Markdown to a printable HTML page. The PDF is then made by Chromium like any other page.
import MarkdownIt from 'markdown-it';

export const PRINT_CSS = `
  @page { size: letter; margin: 0.75in; }
  html { font: 11pt/1.5 -apple-system, "Segoe UI", "Liberation Sans", Arial, "Noto Sans", sans-serif; color: #111; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.4em 0 0.5em; break-after: avoid; }
  h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
  p, ul, ol, table, pre, blockquote { margin: 0 0 0.9em; }
  code { font: 0.92em "Liberation Mono", Menlo, Consolas, monospace; background: #f3f3f3; padding: 0.1em 0.3em; border-radius: 3px; }
  pre { background: #f3f3f3; padding: 0.8em 1em; border-radius: 4px; white-space: pre-wrap; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #444; }
  table { border-collapse: collapse; width: 100%; break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 0.35em 0.6em; text-align: left; vertical-align: top; }
  th { background: #f6f6f6; }
  img { max-width: 100%; }
  a { color: #0645ad; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
`;

/**
 * @param {string} markdown
 * @param {{ allowHtml?: boolean, title?: string, css?: string }} [options]
 *   allowHtml: let raw HTML in the Markdown through; default false, so it shows as text
 *   css: replaces the built-in print style
 * @returns {string}
 */
export function markdownToHtml(markdown, options = {}) {
  if (typeof markdown !== 'string') throw new TypeError('markdown must be a string');
  const md = new MarkdownIt({ html: options.allowHtml ?? false, linkify: true, typographer: true });
  const body = md.render(markdown);
  const title = options.title ?? /^#\s+(.+)$/m.exec(markdown)?.[1] ?? 'Document';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${options.css ?? PRINT_CSS}</style></head><body>${body}</body></html>`;
}

/** @param {string} s */
export function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
