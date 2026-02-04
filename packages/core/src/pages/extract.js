import { modify, fromDocument, selectPages, pagesToNewDocument } from '../modify.js';
import { fail } from '../errors.js';

/**
 * A new document holding the given pages, in the order given. Repeats are allowed.
 * Metadata comes along; bookmarks and form fields do not. The new file is not encrypted.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {import('../modify.js').PageSelection} pages
 * @param {{ password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function extractPages(input, pages, options = {}) {
  if (pages === undefined) fail('INVALID_OPTION', 'Say which pages to extract.');
  return fromDocument(input, options, (pdf, doc) =>
    pagesToNewDocument(pdf, doc, selectPages(pages, pdf.fn.FPDF_GetPageCount(doc))),
  );
}

/**
 * The same document without the given pages. Everything else (metadata, encryption, bookmarks
 * to the pages that remain) is kept.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {import('../modify.js').PageSelection} pages
 * @param {{ password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function removePages(input, pages, options = {}) {
  if (pages === undefined) fail('INVALID_OPTION', 'Say which pages to remove.');
  return modify(input, options, (pdf, doc) => {
    const count = pdf.fn.FPDF_GetPageCount(doc);
    const doomed = [...new Set(selectPages(pages, count))].sort((a, b) => b - a);
    if (doomed.length === count) fail('INVALID_OPTION', 'That would remove every page. A PDF needs at least one.');
    for (const n of doomed) pdf.fn.FPDFPage_Delete(doc, n - 1);
  });
}

/**
 * Put the pages in a new order. `order` lists every page exactly once, e.g. [3, 1, 2].
 * Use extractPages to drop or repeat pages.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {number[] | string} order
 * @param {{ password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function reorder(input, order, options = {}) {
  if (order === undefined) fail('INVALID_OPTION', 'Give the new page order, like [3, 1, 2].');
  return modify(input, options, (pdf, doc) => {
    const count = pdf.fn.FPDF_GetPageCount(doc);
    const pages = selectPages(order, count);
    if (pages.length !== count || new Set(pages).size !== count) {
      fail('INVALID_OPTION', `The new order must list each of the ${count} pages exactly once.`);
    }
    const ptr = pdf.malloc(count * 4);
    try {
      pages.forEach((n, i) => pdf.wasm.setValue(ptr + i * 4, n - 1, 'i32'));
      if (!pdf.fn.FPDF_MovePages(doc, ptr, count, 0)) fail('ENGINE_ERROR', 'The pages could not be moved.');
    } finally {
      pdf.free(ptr);
    }
  });
}
