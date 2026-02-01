import { modify, selectPages } from '../modify.js';
import { fail } from '../errors.js';

/**
 * Turn pages clockwise. The turn adds to any rotation the page already has, the way the rotate
 * button in a viewer does.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ angle: number, pages?: import('../modify.js').PageSelection, password?: string }} options
 *   angle: 90, 180, 270, or negative for anticlockwise
 * @returns {Promise<Uint8Array>}
 */
export async function rotate(input, options) {
  const angle = options?.angle;
  if (typeof angle !== 'number' || angle % 90 !== 0) {
    fail('INVALID_OPTION', 'angle must be a multiple of 90, like 90, 180, 270 or -90.');
  }
  const turns = angle / 90;
  return modify(input, options, (pdf, doc) => {
    for (const number of selectPages(options.pages, pdf.fn.FPDF_GetPageCount(doc))) {
      pdf.withPage(doc, number - 1, (page) => {
        const current = pdf.fn.FPDFPage_GetRotation(page);
        pdf.fn.FPDFPage_SetRotation(page, (((current + turns) % 4) + 4) % 4);
      });
    }
  });
}
