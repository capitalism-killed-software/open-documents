// One entry point for "make this a PDF": works out what the file is and sends it to the right
// converter. LibreOffice and Chromium start the first time they are needed.
import { imagesToPdf, OpenDocumentsError } from '@open-documents/core';
import { sniff } from './sniff.js';
import { createLibreOffice, OFFICE_KINDS } from './libreoffice.js';
import { createChromium } from './chromium.js';
import { markdownToHtml } from './markdown.js';
import { emlToHtml } from './email.js';

/**
 * @typedef {object} ConverterOptions
 * @property {import('./libreoffice.js').LibreOfficeOptions} [libreoffice]
 * @property {import('./chromium.js').ChromiumOptions} [chromium]
 */

/**
 * @typedef {import('./chromium.js').PdfLayout & {
 *   filename?: string,
 *   assets?: Record<string, Uint8Array | string>,
 *   javascript?: boolean,
 *   timeout?: number,
 *   allowHtml?: boolean,
 *   image?: import('@open-documents/core').ImagesToPdfOptions,
 * }} ToPdfOptions
 *   filename helps tell apart files whose bytes look alike (CSV, Markdown and plain text).
 *   Layout options apply to HTML, Markdown and email. assets and javascript apply to HTML.
 *   allowHtml applies to Markdown. image applies to JPEG and PNG.
 */

/**
 * @param {ConverterOptions} [options]
 */
export function createConverter(options = {}) {
  /** @type {Promise<import('./libreoffice.js').LibreOffice> | null} */
  let office = null;
  /** @type {ReturnType<typeof createChromium> | null} */
  let browser = null;
  const libreoffice = () =>
    (office ??= createLibreOffice(options.libreoffice).catch((err) => {
      office = null;
      throw err;
    }));
  const chromium = () => (browser ??= createChromium(options.chromium));
  const decoder = new TextDecoder('utf-8');

  return {
    /**
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {ToPdfOptions} [opts]
     * @returns {Promise<Uint8Array>}
     */
    async toPdf(input, opts = {}) {
      const bytes = await toBytes(input);
      const { kind } = sniff(bytes, { filename: opts.filename });
      if (kind === 'pdf') return bytes;
      if (kind in OFFICE_KINDS) return (await libreoffice()).convert(bytes, { kind: /** @type {keyof typeof OFFICE_KINDS} */ (kind), timeout: opts.timeout });
      if (kind === 'jpeg' || kind === 'png') return imagesToPdf([bytes], opts.image);
      if (kind === 'html') return chromium().htmlToPdf(decoder.decode(bytes), opts);
      if (kind === 'markdown') return chromium().htmlToPdf(markdownToHtml(decoder.decode(bytes), { allowHtml: opts.allowHtml }), { ...opts, javascript: false });
      if (kind === 'eml') {
        const page = await emlToHtml(bytes);
        return chromium().htmlToPdf(page.html, { ...opts, assets: page.assets, javascript: false });
      }
      if (kind === 'msg') throw new OpenDocumentsError('INVALID_INPUT', 'Outlook .msg files are not supported yet. Save the message as .eml and convert that.');
      throw new OpenDocumentsError('INVALID_INPUT', kind === 'unknown' ? 'This file type is not recognised.' : `${kind} files cannot be converted to PDF yet.`);
    },
    /**
     * @param {string} html
     * @param {import('./chromium.js').HtmlOptions} [opts]
     */
    htmlToPdf: (html, opts) => chromium().htmlToPdf(html, opts),
    /**
     * @param {string} url
     * @param {import('./chromium.js').UrlOptions} [opts]
     */
    urlToPdf: (url, opts) => chromium().urlToPdf(url, opts),
    /**
     * @param {string} markdown
     * @param {import('./chromium.js').PdfLayout & { allowHtml?: boolean, timeout?: number }} [opts]
     */
    markdownToPdf: (markdown, opts = {}) => chromium().htmlToPdf(markdownToHtml(markdown, { allowHtml: opts.allowHtml }), { ...opts, javascript: false }),
    async close() {
      const lo = await office?.catch(() => null);
      await Promise.all([lo?.close(), browser?.close()]);
      office = null;
      browser = null;
    },
  };
}

/**
 * @param {Uint8Array | ArrayBuffer | Blob} input
 * @returns {Promise<Uint8Array>}
 */
async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  throw new OpenDocumentsError('INVALID_INPUT', 'Expected a Uint8Array, ArrayBuffer or Blob.');
}
