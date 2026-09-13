// Converting between what a viewer shows and how the page is stored.
//
// A page is stored unrotated, in PDF coordinates (origin bottom left, y up) inside its visible
// box. A viewer turns it clockwise by /Rotate and draws it with the origin top left, y down.
// People think in the second; PDF boxes are written in the first.

/** @typedef {[number, number, number, number]} Box  left, bottom, right, top */

/**
 * @typedef {object} Rect
 * @property {number} x       from the left edge as shown
 * @property {number} y       from the top edge as shown
 * @property {number} width
 * @property {number} height
 */

/**
 * Size of the box as shown, after rotation.
 *
 * @param {Box} box
 * @param {number} quarterTurns
 * @returns {{ width: number, height: number }}
 */
export function shownSize(box, quarterTurns) {
  const width = box[2] - box[0];
  const height = box[3] - box[1];
  return quarterTurns % 2 ? { width: height, height: width } : { width, height };
}

/**
 * A rectangle as shown, turned into a box in the page's own coordinates.
 *
 * @param {Box} box           the page's visible box
 * @param {number} quarterTurns  the page's rotation, 0 to 3
 * @param {Rect} rect
 * @returns {Box}
 */
export function shownRectToBox(box, quarterTurns, rect) {
  const [ax, ay] = shownPointToPage(box, quarterTurns, rect.x, rect.y);
  const [bx, by] = shownPointToPage(box, quarterTurns, rect.x + rect.width, rect.y + rect.height);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/**
 * A point as shown, in the page's own coordinates.
 *
 * @param {Box} box
 * @param {number} quarterTurns
 * @param {number} u  from the left edge as shown
 * @param {number} v  from the top edge as shown
 * @returns {[number, number]}
 */
export function shownPointToPage(box, quarterTurns, u, v) {
  const [x0, y0, x1, y1] = box;
  switch (((quarterTurns % 4) + 4) % 4) {
    case 0:
      return [x0 + u, y1 - v];
    case 1:
      return [x0 + v, y0 + u];
    case 2:
      return [x1 - u, y0 + v];
    default:
      return [x1 - v, y1 - u];
  }
}

/**
 * A point in the page's own coordinates, as shown: the inverse of shownPointToPage.
 *
 * @param {Box} box
 * @param {number} quarterTurns
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]} u from the left edge and v from the top edge, as shown
 */
export function pagePointToShown(box, quarterTurns, x, y) {
  const [x0, y0, x1, y1] = box;
  switch (((quarterTurns % 4) + 4) % 4) {
    case 0:
      return [x - x0, y1 - y];
    case 1:
      return [y - y0, x - x0];
    case 2:
      return [x1 - x, y - y0];
    default:
      return [y1 - y, x1 - x];
  }
}

/**
 * A box as people see it on a page, in the page's own coordinates: for tools that place things
 * in PDF user space, such as signature fields.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ page: number, x: number, y: number, width: number, height: number }} area
 * @param {{ password?: string }} [options]
 * @returns {Promise<Box>} left, bottom, right, top
 */
export async function areaToPageBox(input, area, options = {}) {
  const { engine } = await import('./engine/pdfium.js');
  const { toPdfBytes } = await import('./input.js');
  const { pageNumber, numberIn } = await import('./options.js');
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) => {
    pageNumber(area?.page, 'page', pdf.fn.FPDF_GetPageCount(doc));
    for (const key of /** @type {const} */ (['x', 'y'])) numberIn(area[key], key, -100_000, 100_000);
    for (const key of /** @type {const} */ (['width', 'height'])) numberIn(area[key], key, 1, 100_000);
    return pdf.withPage(doc, area.page - 1, (page) => shownRectToBox(pdf.visibleBox(page), pdf.fn.FPDFPage_GetRotation(page), area));
  });
}
