// Email to a printable page: the headers people expect at the top, the message below, inline
// pictures taken from the message itself. Rendered like any other page, with scripts off and
// no network, so a message cannot reach out when it is converted.
import PostalMime from 'postal-mime';
import { OpenDocumentsError } from '@open-documents/core';
import { escape } from './markdown.js';

const EMAIL_CSS = `
  @page { size: letter; margin: 0.6in; }
  body { font: 10.5pt/1.45 -apple-system, "Segoe UI", "Liberation Sans", Arial, "Noto Sans", sans-serif; color: #111; }
  table.headers { border-collapse: collapse; margin-bottom: 0.6em; }
  table.headers th { text-align: right; padding: 0.1em 0.8em 0.1em 0; color: #555; font-weight: normal; vertical-align: top; white-space: nowrap; }
  table.headers td { padding: 0.1em 0; }
  .subject { font-size: 1.35em; font-weight: bold; margin: 0 0 0.4em; }
  .attachments { color: #555; margin: 0.4em 0 0; }
  hr { border: none; border-top: 1px solid #ccc; margin: 0.8em 0 1em; }
  pre.text { white-space: pre-wrap; font: inherit; margin: 0; }
  .message img { max-width: 100%; }
`;

/**
 * @typedef {object} EmailPage
 * @property {string} html
 * @property {Record<string, Uint8Array>} assets  inline pictures, by the path the html uses
 * @property {string} subject
 * @property {{ filename: string, mimeType: string, size: number }[]} attachments
 */

/**
 * @param {Uint8Array} bytes  an RFC 822 message (.eml)
 * @returns {Promise<EmailPage>}
 */
export async function emlToHtml(bytes) {
  let email;
  try {
    email = await PostalMime.parse(bytes);
  } catch (err) {
    throw new OpenDocumentsError('INVALID_INPUT', 'This email could not be read.', { cause: err });
  }
  /** @type {Record<string, Uint8Array>} */
  const assets = {};
  const attachments = [];
  for (const a of email.attachments ?? []) {
    const data = new Uint8Array(typeof a.content === 'string' ? new TextEncoder().encode(a.content) : a.content);
    const cid = a.contentId?.replace(/^<|>$/g, '');
    if (cid && (a.related || a.disposition === 'inline')) assets[`cid/${encodeURIComponent(cid)}`] = data;
    else attachments.push({ filename: a.filename ?? 'attachment', mimeType: a.mimeType, size: data.length });
  }
  const who = (/** @type {any} */ list) =>
    (Array.isArray(list) ? list : list ? [list] : [])
      .map((/** @type {{ name?: string, address?: string }} */ p) => (p.name ? `${escape(p.name)} &lt;${escape(p.address ?? '')}&gt;` : escape(p.address ?? '')))
      .join(', ');
  const dateHeader = email.headers?.find((h) => h.key === 'date')?.value ?? email.date ?? '';
  const rows = /** @type {[string, string][]} */ ([
    ['From', who(email.from)],
    ['To', who(email.to)],
    ['Cc', who(email.cc)],
    ['Date', escape(dateHeader)],
  ]).filter(([, v]) => v);
  const subject = email.subject ?? '';
  const body = email.html
    ? email.html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\b(src|background)=(["'])cid:([^"']+)\2/gi, (_, attr, q, cid) => `${attr}=${q}cid/${encodeURIComponent(cid)}${q}`)
    : `<pre class="text">${escape(email.text ?? '')}</pre>`;
  const list = attachments.length
    ? `<p class="attachments">Attachments: ${attachments.map((a) => `${escape(a.filename)} (${size(a.size)})`).join(', ')}</p>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(subject)}</title><style>${EMAIL_CSS}</style></head><body>
<p class="subject">${escape(subject)}</p>
<table class="headers">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>${list}
<hr><div class="message">${body}</div></body></html>`;
  return { html, assets, subject, attachments };
}

/** @param {number} bytes */
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
