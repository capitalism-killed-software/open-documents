// Every PDF operation the API offers, as POST /v1/pdf/<name>. Each takes the uploaded files and
// the parsed `options` field, and returns what to send back.
import * as od from '@open-documents/core';
import { zipSync } from 'fflate';

/**
 * @typedef {{ type: string, body: Uint8Array | object, filename?: string }} Reply
 * @typedef {{ converter: ReturnType<typeof import('@open-documents/node').createConverter> }} Context
 * @typedef {{ files: 'one' | 'many', run: (files: Uint8Array[], options: Record<string, any>, ctx: Context) => Promise<Reply> }} Operation
 */

/** @param {Uint8Array} body @returns {Reply} */
const pdf = (body) => ({ type: 'application/pdf', body });
/** @param {object} body @returns {Reply} */
const json = (body) => ({ type: 'application/json', body });
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
  'set-bookmarks': { files: 'one', run: async ([f], o) => pdf(await od.setBookmarks(f, o.bookmarks, o)) },

  // security
  encrypt: { files: 'one', run: async ([f], o) => pdf(await od.encrypt(f, /** @type {any} */ (o))) },
  decrypt: { files: 'one', run: async ([f], o) => pdf(await od.decrypt(f, o)) },

  // structure, with qpdf
  compress: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.compress(f, o)) },
  linearize: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.linearize(f, o)) },
  repair: { files: 'one', run: async ([f], o, ctx) => pdf(await ctx.converter.repair(f, o)) },

  // building
  'images-to-pdf': { files: 'many', run: async (files, o) => pdf(await od.imagesToPdf(files, o)) },
};
