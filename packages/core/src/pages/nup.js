import { fromDocument, copyMetadata } from '../modify.js';
import { fail } from '../errors.js';
import { numberIn } from '../options.js';

/**
 * Put several pages on each sheet, the way a printer's "pages per sheet" does. Pages run left
 * to right, then top to bottom, scaled to fit and centred in their cells.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ columns?: number, rows?: number, pageSize?: [number, number], password?: string }} [options]
 *   columns defaults to 2 and rows to 1. pageSize is the sheet in points; by default it is the
 *   first page's size, turned to landscape when there are more columns than rows.
 * @returns {Promise<Uint8Array>}
 */
export async function nUp(input, options = {}) {
  const columns = whole(options.columns ?? 2, 'columns');
  const rows = whole(options.rows ?? 1, 'rows');
  return fromDocument(input, options, (pdf, src) => {
    const { fn } = pdf;
    let [width, height] = options.pageSize ?? firstPageSize(pdf, src);
    numberIn(width, 'pageSize width', 72, 14400);
    numberIn(height, 'pageSize height', 72, 14400);
    if (!options.pageSize && (columns > rows) !== (width > height) && columns !== rows) [width, height] = [height, width];

    const sheets = fn.FPDF_ImportNPagesToOne(src, width, height, columns, rows);
    if (!sheets) fail('ENGINE_ERROR', 'The pages could not be laid out.');
    try {
      copyMetadata(pdf, src, sheets);
      return pdf.save(sheets);
    } finally {
      fn.FPDF_CloseDocument(sheets);
    }
  });
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @returns {[number, number]}
 */
function firstPageSize(pdf, doc) {
  return pdf.withPage(doc, 0, (page) => [pdf.fn.FPDF_GetPageWidthF(page), pdf.fn.FPDF_GetPageHeightF(page)]);
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function whole(value, name) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 1 || /** @type {number} */ (value) > 16) {
    fail('INVALID_OPTION', `${name} must be a whole number from 1 to 16.`);
  }
  return /** @type {number} */ (value);
}
