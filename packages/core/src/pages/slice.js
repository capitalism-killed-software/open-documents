import { fromDocument, selectPages, copyMetadata } from '../modify.js';
import { shownRectToBox, shownSize } from '../geometry.js';
import { fail } from '../errors.js';

/**
 * Cut pages into pieces, each its own page: a scanned spread into two pages, a poster into
 * tiles. Pieces run left to right, then top to bottom, as the page is shown. Pages not
 * selected are kept whole.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ columns?: number, rows?: number, pages?: import('../modify.js').PageSelection, password?: string }} [options]
 *   columns defaults to 2 and rows to 1, which halves each page down the middle
 * @returns {Promise<Uint8Array>}
 */
export async function slicePages(input, options = {}) {
  const columns = wholeNumber(options.columns ?? 2, 'columns');
  const rows = wholeNumber(options.rows ?? 1, 'rows');
  if (columns * rows === 1) fail('INVALID_OPTION', 'One column and one row would leave the page as it is.');
  const pieces = columns * rows;

  return fromDocument(input, options, (pdf, src) => {
    const { fn } = pdf;
    const count = fn.FPDF_GetPageCount(src);
    const selected = new Set(selectPages(options.pages, count));
    return pdf.withNewDocument((dest) => {
      let at = 0;
      for (let n = 1; n <= count; n++) {
        if (!selected.has(n)) {
          pdf.importPages(dest, src, [n - 1], at++);
          continue;
        }
        pdf.importPages(dest, src, Array(pieces).fill(n - 1), at);
        for (let k = 0; k < pieces; k++) {
          pdf.withPage(dest, at + k, (page) => {
            const turns = fn.FPDFPage_GetRotation(page);
            const box = pdf.visibleBox(page);
            const shown = shownSize(box, turns);
            const width = shown.width / columns;
            const height = shown.height / rows;
            const cell = shownRectToBox(box, turns, {
              x: (k % columns) * width,
              y: Math.floor(k / columns) * height,
              width,
              height,
            });
            fn.FPDFPage_SetMediaBox(page, ...cell);
            fn.FPDFPage_SetCropBox(page, ...cell);
          });
        }
        at += pieces;
      }
      copyMetadata(pdf, src, dest);
      fn.FPDF_CopyViewerPreferences(dest, src);
      return pdf.save(dest);
    });
  });
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function wholeNumber(value, name) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 1 || /** @type {number} */ (value) > 50) {
    fail('INVALID_OPTION', `${name} must be a whole number from 1 to 50.`);
  }
  return /** @type {number} */ (value);
}
