import { modify, selectPages } from '../modify.js';
import { shownRectToBox, shownSize } from '../geometry.js';
import { fail } from '../errors.js';

/**
 * @typedef {object} Margins
 * @property {number} [top]
 * @property {number} [right]
 * @property {number} [bottom]
 * @property {number} [left]
 */

/**
 * Crop pages to a smaller visible area. Give `margins` (points to trim from each edge, or one
 * number for all four) or `box` (the area to keep). Both are measured on the page as it is
 * shown, from its top left, rotation included. Only the crop box changes, so the trimmed
 * content is hidden, not deleted: use redaction to remove content.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ margins?: number | Margins, box?: import('../geometry.js').Rect, pages?: import('../modify.js').PageSelection, password?: string }} options
 * @returns {Promise<Uint8Array>}
 */
export async function crop(input, options) {
  const { margins, box } = options ?? {};
  if ((margins === undefined) === (box === undefined)) fail('INVALID_OPTION', 'Give either margins or box.');
  return modify(input, options, (pdf, doc) => {
    for (const number of selectPages(options.pages, pdf.fn.FPDF_GetPageCount(doc))) {
      pdf.withPage(doc, number - 1, (page) => {
        const turns = pdf.fn.FPDFPage_GetRotation(page);
        const visible = pdf.visibleBox(page);
        const shown = shownSize(visible, turns);
        const rect = box ?? marginsToRect(margins, shown);
        const { x, y, width, height } = rect;
        if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > shown.width + 0.01 || y + height > shown.height + 0.01) {
          fail('INVALID_OPTION', `The area to keep on page ${number} must lie inside its ${round(shown.width)} x ${round(shown.height)} pt.`);
        }
        pdf.fn.FPDFPage_SetCropBox(page, ...shownRectToBox(visible, turns, rect));
      });
    }
  });
}

/**
 * @param {number | Margins | undefined} margins
 * @param {{ width: number, height: number }} shown
 * @returns {import('../geometry.js').Rect}
 */
function marginsToRect(margins, shown) {
  const m = typeof margins === 'number' ? { top: margins, right: margins, bottom: margins, left: margins } : (margins ?? {});
  const { top = 0, right = 0, bottom = 0, left = 0 } = m;
  return { x: left, y: top, width: shown.width - left - right, height: shown.height - top - bottom };
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;
