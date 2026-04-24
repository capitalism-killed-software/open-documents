// Email to a printable page: the headers people expect at the top, the message below, inline
// pictures taken from the message itself. Rendered like any other page, with scripts off and
// no network, so a message cannot reach out when it is converted.
import PostalMime from 'postal-mime';
import msgreader from '@kenjiuno/msgreader';
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
    (Array.isArray(list) ? list : list ? [list] : []).map((/** @type {{ name?: string, address?: string }} */ p) => ({ name: p.name ?? '', address: p.address ?? '' }));
  const dateHeader = email.headers?.find((h) => h.key === 'date')?.value ?? email.date ?? '';
  return page({
    subject: email.subject ?? '',
    from: who(email.from),
    to: who(email.to),
    cc: who(email.cc),
    date: dateHeader,
    html: email.html ?? null,
    text: email.text ?? '',
    assets,
    attachments,
  });
}

/**
 * @param {Uint8Array} bytes  an Outlook message (.msg)
 * @returns {Promise<EmailPage>}
 */
export async function msgToHtml(bytes) {
  let reader;
  let data;
  try {
    reader = new msgreader.default(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    data = reader.getFileData();
  } catch (err) {
    throw new OpenDocumentsError('INVALID_INPUT', 'This Outlook message could not be read.', { cause: err });
  }
  if (data.error) throw new OpenDocumentsError('INVALID_INPUT', `This Outlook message could not be read: ${data.error}`);
  if (!data.subject && !data.body && !data.html && !data.bodyHtml && !data.senderName && !data.recipients?.length) {
    throw new OpenDocumentsError('INVALID_INPUT', 'This Outlook file holds no message: no sender, recipients, subject or body.');
  }
  /** @type {Record<string, Uint8Array>} */
  const assets = {};
  const attachments = [];
  for (const a of data.attachments ?? []) {
    const file = reader.getAttachment(a);
    const content = new Uint8Array(file.content);
    if (a.pidContentId) assets[`cid/${encodeURIComponent(a.pidContentId)}`] = content;
    else attachments.push({ filename: file.fileName ?? 'attachment', mimeType: a.attachMimeTag ?? 'application/octet-stream', size: content.length });
  }
  const people = (/** @type {string} */ kind) =>
    (data.recipients ?? [])
      .filter((r) => (kind === 'cc' ? r.recipType === 'cc' : r.recipType !== 'cc' && r.recipType !== 'bcc'))
      .map((r) => ({ name: r.name ?? '', address: r.smtpAddress ?? r.email ?? '' }));
  return page({
    subject: data.subject ?? '',
    from: [{ name: data.senderName ?? '', address: data.senderSmtpAddress ?? data.senderEmail ?? '' }].filter((p) => p.name || p.address),
    to: people('to'),
    cc: people('cc'),
    date: data.messageDeliveryTime ?? data.clientSubmitTime ?? '',
    html: data.html ? new TextDecoder().decode(data.html) : (data.bodyHtml ?? null),
    text: data.body ?? '',
    assets,
    attachments,
  });
}

/**
 * The page both kinds of email turn into.
 *
 * @param {{
 *   subject: string, from: { name: string, address: string }[], to: { name: string, address: string }[],
 *   cc: { name: string, address: string }[], date: string, html: string | null, text: string,
 *   assets: Record<string, Uint8Array>, attachments: EmailPage['attachments'],
 * }} m
 * @returns {EmailPage}
 */
function page(m) {
  const who = (/** @type {{ name: string, address: string }[]} */ list) =>
    list.map((p) => (p.name ? `${escape(p.name)} &lt;${escape(p.address)}&gt;` : escape(p.address))).join(', ');
  const rows = /** @type {[string, string][]} */ ([
    ['From', who(m.from)],
    ['To', who(m.to)],
    ['Cc', who(m.cc)],
    ['Date', escape(m.date)],
  ]).filter(([, v]) => v);
  const body = m.html
    ? m.html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\b(src|background)=(["'])cid:([^"']+)\2/gi, (_, attr, q, cid) => `${attr}=${q}cid/${encodeURIComponent(cid)}${q}`)
    : `<pre class="text">${escape(m.text)}</pre>`;
  const list = m.attachments.length
    ? `<p class="attachments">Attachments: ${m.attachments.map((a) => `${escape(a.filename)} (${size(a.size)})`).join(', ')}</p>`
    : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(m.subject)}</title><style>${EMAIL_CSS}</style></head><body>
<p class="subject">${escape(m.subject)}</p>
<table class="headers">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>${list}
<hr><div class="message">${body}</div></body></html>`;
  return { html, assets: m.assets, subject: m.subject, attachments: m.attachments };
}

/** @param {number} bytes */
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
