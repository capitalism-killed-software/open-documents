import { modify } from '../modify.js';
import { fail } from '../errors.js';
import { numberIn } from '../options.js';

/**
 * Insert blank pages. `at` is the page number the first new page will have: 1 puts them at the
 * front, the page count plus one at the end. They take the size of the page they are inserted
 * before (or the last page, at the end) unless `size` says otherwise.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ at: number, count?: number, size?: [number, number], password?: string }} options
 * @returns {Promise<Uint8Array>}
 */
export async function insertBlankPages(input, options) {
  if (!options) fail('INVALID_OPTION', 'Say where to insert, like { at: 1 }.');
  const count = options.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 1000) fail('INVALID_OPTION', 'count must be a whole number from 1 to 1000.');
  return modify(input, options, (pdf, doc) => {
    const { fn } = pdf;
    const pages = fn.FPDF_GetPageCount(doc);
    const at = options.at;
    if (!Number.isInteger(at) || at < 1 || at > pages + 1) {
      fail('INVALID_OPTION', `at must be a page number from 1 to ${pages + 1}.`);
    }
    const [width, height] = options.size ?? pdf.withPage(doc, Math.min(at, pages) - 1, (page) => [
      fn.FPDF_GetPageWidthF(page),
      fn.FPDF_GetPageHeightF(page),
    ]);
    numberIn(width, 'size width', 1, 14400);
    numberIn(height, 'size height', 1, 14400);
    for (let i = 0; i < count; i++) {
      const page = fn.FPDFPage_New(doc, at - 1 + i, width, height);
      if (!page) fail('ENGINE_ERROR', 'Could not add a page.');
      fn.FPDF_ClosePage(page);
    }
  });
}
