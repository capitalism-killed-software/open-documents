// One entry point for "make this a PDF": works out what the file is and sends it to the right
// converter. LibreOffice and Chromium start the first time they are needed.
import { imagesToPdf, toPdfA, OpenDocumentsError } from '@open-documents/core';
import { sniff } from './sniff.js';
import { createLibreOffice, OFFICE_KINDS } from './libreoffice.js';
import { createChromium } from './chromium.js';
import { markdownToHtml } from './markdown.js';
import { emlToHtml, msgToHtml } from './email.js';
import { createQpdf } from './qpdf.js';
import { createDocling } from './docling.js';

/**
 * @typedef {object} ConverterOptions
 * @property {import('./libreoffice.js').LibreOfficeOptions} [libreoffice]
 * @property {import('./chromium.js').ChromiumOptions} [chromium]
 * @property {{ binary?: string, timeout?: number }} [qpdf]
 * @property {import('./docling.js').DoclingOptions} [docling]
 */

/**
 * @typedef {{ pages?: import('@open-documents/core').PageSelection, password?: string, timeout?: number }} StructureOptions
 */

/**
 * @typedef {import('./chromium.js').PdfLayout & {
 *   filename?: string,
 *   assets?: Record<string, Uint8Array | string>,
 *   javascript?: boolean,
 *   timeout?: number,
 *   allowHtml?: boolean,
 *   image?: import('@open-documents/core').ImagesToPdfOptions,
 *   pdfa?: 1 | 2 | 3,
 * }} ToPdfOptions
 *   filename helps tell apart files whose bytes look alike (CSV, Markdown and plain text).
 *   Layout options apply to HTML, Markdown and email. assets and javascript apply to HTML.
 *   allowHtml applies to Markdown. image applies to JPEG and PNG. pdfa makes PDF/A-1b, 2b or
 *   3b: office files through LibreOffice's own PDF/A export, everything else with core's
 *   toPdfA() afterwards (check the result with checkPdfA()).
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
  /** @type {ReturnType<typeof createQpdf> | null} */
  let structural = null;
  const qpdf = () =>
    (structural ??= createQpdf(options.qpdf).catch((err) => {
      structural = null;
      throw err;
    }));
  /** @type {Promise<Awaited<ReturnType<typeof createDocling>>> | null} */
  let structure = null;
  const docling = () =>
    (structure ??= createDocling(options.docling).catch((err) => {
      structure = null;
      throw err;
    }));
  /**
   * @param {Uint8Array | ArrayBuffer | Blob} input
   * @param {StructureOptions} opts
   * @param {'markdown' | 'html' | 'json' | 'xlsx'} to
   */
  const read = async (input, opts, to) => (await docling()).convert(await toBytes(input), { ...opts, to: [to] });
  const decoder = new TextDecoder('utf-8');
  /**
   * Any supported file to an ordinary PDF.
   *
   * @param {Uint8Array} bytes
   * @param {string} kind
   * @param {ToPdfOptions} opts
   * @returns {Promise<Uint8Array>}
   */
const plain = async (bytes, kind, opts) => {
    if (kind === 'pdf') return bytes;
    if (kind === 'jpeg' || kind === 'png') return imagesToPdf([bytes], opts.image);
    if (kind === 'html') return chromium().htmlToPdf(decoder.decode(bytes), opts);
    if (kind === 'markdown') return chromium().htmlToPdf(markdownToHtml(decoder.decode(bytes), { allowHtml: opts.allowHtml }), { ...opts, javascript: false });
    if (kind === 'eml' || kind === 'msg') {
      const page = kind === 'eml' ? await emlToHtml(bytes) : await msgToHtml(bytes);
      return chromium().htmlToPdf(page.html, { ...opts, assets: page.assets, javascript: false });
    }
    throw new OpenDocumentsError('INVALID_INPUT', kind === 'unknown' ? 'This file type is not recognised.' : `${kind} files cannot be converted to PDF yet.`);
  };

  return {
    /**
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {ToPdfOptions} [opts]
     * @returns {Promise<Uint8Array>}
     */
    async toPdf(input, opts = {}) {
      if (opts.pdfa !== undefined && ![1, 2, 3].includes(opts.pdfa)) throw new OpenDocumentsError('INVALID_OPTION', 'pdfa must be 1, 2 or 3.');
      const bytes = await toBytes(input);
      const { kind } = sniff(bytes, { filename: opts.filename });
      if (kind in OFFICE_KINDS) return (await libreoffice()).convert(bytes, { kind: /** @type {keyof typeof OFFICE_KINDS} */ (kind), timeout: opts.timeout, pdfa: opts.pdfa });
      const pdf = await plain(bytes, kind, opts);
      return opts.pdfa ? toPdfA(pdf, { part: opts.pdfa }) : pdf;
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
    /**
     * Smaller without losing anything (qpdf). Images are left as they are.
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {{ password?: string }} [opts]
     */
    compress: async (input, opts) => (await qpdf()).compress(await toBytes(input), opts),
    /**
     * Fast web view (qpdf).
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {{ password?: string }} [opts]
     */
    linearize: async (input, opts) => (await qpdf()).linearize(await toBytes(input), opts),
    /**
     * Rebuild a damaged file's structure (qpdf).
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {{ password?: string }} [opts]
     */
    repair: async (input, opts) => (await qpdf()).repair(await toBytes(input), opts),
    /**
     * PDF to Markdown, with headings, lists and tables, in reading order (Docling).
     *
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {StructureOptions} [opts]
     */
    async pdfToMarkdown(input, opts = {}) {
      return /** @type {string} */ ((await read(input, opts, 'markdown')).markdown);
    },
    /**
     * PDF to one HTML page, with the same structure (Docling).
     *
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {StructureOptions} [opts]
     */
    async pdfToHtml(input, opts = {}) {
      return /** @type {string} */ ((await read(input, opts, 'html')).html);
    },
    /**
     * PDF to Docling's document model as JSON: every text, table and picture with its page and box.
     *
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {StructureOptions} [opts]
     * @returns {Promise<Record<string, any>>}
     */
    async pdfToJson(input, opts = {}) {
      return /** @type {Record<string, any>} */ ((await read(input, opts, 'json')).json);
    },
    /**
     * The tables in a PDF as an Excel workbook, one sheet per table (Docling's table model).
     *
     * @param {Uint8Array | ArrayBuffer | Blob} input
     * @param {StructureOptions} [opts]
     * @returns {Promise<Uint8Array>}
     */
    async pdfToXlsx(input, opts = {}) {
      const result = await read(input, opts, 'xlsx');
      if (!result.xlsx) throw new OpenDocumentsError('CONVERSION_FAILED', 'No tables were found in the document.');
      return result.xlsx;
    },
    async close() {
      const lo = await office?.catch(() => null);
      const dl = await structure?.catch(() => null);
      await Promise.all([lo?.close(), browser?.close(), dl?.close()]);
      office = null;
      browser = null;
      structure = null;
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
