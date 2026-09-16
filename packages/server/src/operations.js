// Every PDF operation the API offers, as POST /v1/pdf/<name>. Each takes the uploaded files and
// the parsed `options` field, and returns what to send back.
import * as od from '@open-documents/core';
import { zipSync } from 'fflate';

/**
 * @typedef {{ type: string, body: Uint8Array | string | object, filename?: string }} Reply
 * @typedef {{ converter: any, ocr: (options: Record<string, any>) => Promise<any>, timestampUrl?: string, trustRoots?: Uint8Array[] }} Context
 *   converter: from createConverter() in @open-documents/node; ocr: the server's OCR engine from
 *   createOcr() in @open-documents/ocr, started on first use
 * @typedef {{ files: 'one' | 'many', run: (files: Uint8Array[], options: Record<string, any>, ctx: Context) => Promise<Reply> }} Operation
 */

/** @param {Uint8Array} body @returns {Reply} */
const pdf = (body) => ({ type: 'application/pdf', body });
/** @param {object} body @returns {Reply} */
const json = (body) => ({ type: 'application/json', body });
/** @param {Uint8Array} body @returns {Reply} */
const docx = (body) => ({ type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body });
/** @param {Uint8Array} body @returns {Reply} */
const pptx = (body) => ({ type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body });
/** @param {Record<string, Uint8Array>} files @returns {Reply} */
const zip = (files) => ({ type: 'application/zip', body: zipSync(files, { level: 0 }) });

/**
 * @param {{ page: number, data: Uint8Array }[]} images
 * @returns {Reply}
 */
const pngs = (images) =>
  images.length === 1
    ? { type: 'image/png', body: images[0].data }
    : zip(Object.fromEntries(images.map((p) => [`page-${p.page}.png`, p.data])));

/** @type {Record<string, Operation>} */
export const OPERATIONS = {
  // reading
  inspect: { files: 'one', run: async ([f], o) => json(await od.inspect(f, o)) },
  text: { files: 'one', run: async ([f], o) => json(await od.extractText(f, o)) },
  words: { files: 'one', run: async ([f], o) => json(await od.extractWords(f, o)) },
  bookmarks: { files: 'one', run: async ([f], o) => json(await od.getBookmarks(f, o)) },
  render: { files: 'one', run: async ([f], o) => pngs(await od.renderPages(f, { ...o, format: 'png' })) },
  thumbnails: { files: 'one', run: async ([f], o) => pngs(await od.thumbnails(f, o)) },

  // pages
  merge: {
    files: 'many',
    run: async (files, o) => pdf(await od.merge(files.map((input, i) => ({ ...(o.items?.[i] ?? {}), input })), { bookmarks: o.bookmarks })),
  },
  split: {
    files: 'one',
    run: async ([f], o) => {
      const parts = await od.split(f, o);
      const digits = String(parts.length).length;
      return zip(Object.fromEntries(parts.map((p, i) => [`part-${String(i + 1).padStart(digits, '0')}.pdf`, p])));
    },
  },
  'extract-pages': { files: 'one', run: async ([f], o) => pdf(await od.extractPages(f, o.pages, o)) },
  'remove-pages': { files: 'one', run: async ([f], o) => pdf(await od.removePages(f, o.pages, o)) },
  reorder: { files: 'one', run: async ([f], o) => pdf(await od.reorder(f, o.order, o)) },
  rotate: { files: 'one', run: async ([f], o) => pdf(await od.rotate(f, /** @type {any} */ (o))) },
  slice: { files: 'one', run: async ([f], o) => pdf(await od.slicePages(f, o)) },
  crop: { files: 'one', run: async ([f], o) => pdf(await od.crop(f, /** @type {any} */ (o))) },
  'n-up': { files: 'one', run: async ([f], o) => pdf(await od.nUp(f, o)) },
  'insert-blank-pages': { files: 'one', run: async ([f], o) => pdf(await od.insertBlankPages(f, /** @type {any} */ (o))) },

  // edit
  'add-text': { files: 'one', run: async ([f], o) => pdf(await od.addText(f, /** @type {any} */ (o))) },
  watermark: { files: 'one', run: async ([f], o) => pdf(await od.watermark(f, /** @type {any} */ (o))) },
  'page-numbers': { files: 'one', run: async ([f], o) => pdf(await od.pageNumbers(f, o)) },
  'header-footer': { files: 'one', run: async ([f], o) => pdf(await od.headerFooter(f, /** @type {any} */ (o))) },
  bates: { files: 'one', run: async ([f], o) => pdf(await od.bates(f, o)) },
  metadata: { files: 'one', run: async ([f], o) => pdf(await od.setMetadata(f, o)) },
  'compress-images': { files: 'one', run: async ([f], o) => pdf(await od.compressImages(f, o)) },
  'set-bookmarks': { files: 'one', run: async ([f], o) => pdf(await od.setBookmarks(f, o.bookmarks, o)) },
  overlay: {
    files: 'many',
    run: async (files, o) => {
      if (files.length !== 2) throw new od.OpenDocumentsError('INVALID_INPUT', 'overlay takes two files: the document, then the layer.');
      return pdf(await od.overlay(files[0], files[1], o));
    },
  },

  // forms
  'form-fields': { files: 'one', run: async ([f], o) => json(await od.getFormFields(f, o)) },
  'fill-form': { files: 'one', run: async ([f], o) => pdf(await od.fillForm(f, o.values, o)) },
  'add-form-fields': { files: 'one', run: async ([f], o) => pdf(await od.addFormFields(f, o.fields, o)) },
  flatten: { files: 'one', run: async ([f], o) => pdf(await od.flatten(f, o)) },

  // signatures: the PDF, then the PKCS#12 file; a timestamp only from the server's own authority
  sign: {
    files: 'many',
    run: async (files, o, ctx) => {
      if (files.length !== 2) throw new od.OpenDocumentsError('INVALID_INPUT', 'sign takes two files: the PDF, then the PKCS#12 (.p12, .pfx) certificate.');
      const { timestampUrl: _t, certificate: _c, ...rest } = o;
      return pdf(await ctx.converter.sign(files[0], { ...rest, certificate: files[1], timestampUrl: ctx.timestampUrl }));
    },
  },
  'verify-signatures': {
    files: 'many',
    run: async ([f, ...roots], o, ctx) => json(await ctx.converter.verifySignatures(f, { trustRoots: [...(ctx.trustRoots ?? []), ...roots], documentPassword: o.documentPassword })),
  },

  // redaction: literal words only, never patterns, so a request cannot make the server spin
  redact: { files: 'one', run: async ([f], o) => pdf(await od.redact(f, redactOptions(o))) },
  'verify-redaction': { files: 'one', run: async ([f], o) => json(await od.verifyRedaction(f, redactOptions(o))) },

  // PDF/A
  'check-pdfa': { files: 'one', run: async ([f], o) => json(await od.checkPdfA(f, o)) },
  'to-pdfa': { files: 'one', run: async ([f], o) => pdf(await od.toPdfA(f, o)) },

  // two versions of a document: the first file, then the second
  'compare-text': { files: 'many', run: async (files, o) => json(await od.compareText(...two(files, 'compare-text'), o)) },
  'compare-visual': {
    files: 'many',
    run: async (files, o) => json((await od.compareVisual(...two(files, 'compare-visual'), o)).map(({ image, ...page }) => ({ ...page, ...(image ? { png: Buffer.from(image).toString('base64') } : {}) }))),
  },
  'compare-report': { files: 'many', run: async (files, o) => pdf(await od.compareReport(...two(files, 'compare-report'), o)) },

  // security
  encrypt: { files: 'one', run: async ([f], o) => pdf(await od.encrypt(f, /** @type {any} */ (o))) },
  decrypt: { files: 'one', run: async ([f], o) => pdf(await od.decrypt(f, o)) },

  // structure, with qpdf
  compress: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.compress(f, o)) },
  linearize: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.linearize(f, o)) },
  repair: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.repair(f, o)) },

  // OCR, with Tesseract
  ocr: { files: 'one', run: async ([f], o, ctx) => pdf(await (await ctx.ocr(o)).ocr(f, pageOptions(o, true))) },
  recognize: { files: 'one', run: async ([f], o, ctx) => json(await (await ctx.ocr(o)).recognize(f, pageOptions(o, false))) },

  // out of PDF
  'to-docx': { files: 'one', run: async ([f], o) => docx(await od.toDocx(f, o)) },
  'to-pptx': { files: 'one', run: async ([f], o) => pptx(await od.toPptx(f, o)) },
  // the structure of the document, with Docling
  'to-markdown': { files: 'one', run: async ([f], o, ctx) => ({ type: 'text/markdown; charset=utf-8', body: await ctx.converter.pdfToMarkdown(f, structure(o)) }) },
  'to-html': { files: 'one', run: async ([f], o, ctx) => ({ type: 'text/html; charset=utf-8', body: await ctx.converter.pdfToHtml(f, structure(o)) }) },
  'to-json': { files: 'one', run: async ([f], o, ctx) => json(await ctx.converter.pdfToJson(f, structure(o))) },
  'to-xlsx': {
    files: 'one',
    run: async ([f], o, ctx) => ({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: await ctx.converter.pdfToXlsx(f, structure(o)) }),
  },

  // building
  'images-to-pdf': { files: 'many', run: async (files, o) => pdf(await od.imagesToPdf(files, o)) },
};

/**
 * Only the options OCR takes from a request; callbacks and engine settings stay on the server.
 *
 * @param {Record<string, any>} o
 * @param {boolean} force  whether `force` applies
 */
function pageOptions(o, force) {
  return { pages: o.pages, dpi: o.dpi, password: o.password, ...(force ? { force: o.force } : {}) };
}

/**
 * Options Docling takes from a request.
 *
 * @param {Record<string, any>} o
 */
function structure(o) {
  return { pages: o.pages, password: o.password };
}

/**
 * @param {Uint8Array[]} files
 * @param {string} name
 * @returns {[Uint8Array, Uint8Array]}
 */
function two(files, name) {
  if (files.length !== 2) throw new od.OpenDocumentsError('INVALID_INPUT', `${name} takes two files: the first version, then the second.`);
  return [files[0], files[1]];
}

/**
 * @param {Record<string, any>} o
 */
function redactOptions(o) {
  if (o.text !== undefined && (!Array.isArray(o.text) || o.text.some((t) => typeof t !== 'string'))) {
    throw new od.OpenDocumentsError('INVALID_OPTION', 'text must be a list of words to redact. Patterns are not taken over HTTP.');
  }
  return { areas: o.areas, text: o.text, ignoreCase: o.ignoreCase, pages: o.pages, color: o.color, metadata: o.metadata, password: o.password };
}
