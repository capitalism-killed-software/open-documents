// Drawing text onto existing pages: the shared part of watermarks, page numbers, headers,
// footers and Bates numbers. Text is placed in the coordinates people see (origin top left,
// rotation applied) and turned the right way up on rotated pages.
import { modify, selectPages } from '../modify.js';
import { shownSize, shownPointToPage } from '../geometry.js';
import { fail } from '../errors.js';
import { argbColor, numberIn } from '../options.js';

export const STANDARD_FONTS = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
];

export const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

/**
 * How a piece of text looks.
 *
 * @typedef {object} TextStyle
 * @property {string} [font]     one of the 12 standard fonts; default Helvetica
 * @property {number} [size]     points
 * @property {string} [color]    "#rrggbb"; default black
 * @property {number} [opacity]  0 to 1; default 1
 */

/**
 * One piece of text to put on a page.
 *
 * @typedef {object} Placement
 * @property {string} text
 * @property {string} [position]  one of POSITIONS, measured inside the margin; default center
 * @property {{ x: number, y: number }} [at]  top left of the text as shown, instead of position
 * @property {number} [margin]   points from the page edge, for positions; default 36
 * @property {number} [angle]    degrees, anticlockwise as shown; default 0
 * @property {boolean} [behind]  look as if drawn under the page content. PDFium can only add
 *   content on top, so this draws on top with multiply blending: dark content stays dark and
 *   shows through, white areas take the colour. Same look on ordinary pages.
 */

// The standard fonts only cover Latin text (WinAnsi). Anything else would come out as blanks.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * @param {string} text
 * @param {string} name
 */
export function checkLatin(text, name) {
  if (typeof text !== 'string') fail('INVALID_OPTION', `${name} must be a string.`);
  for (const char of text) {
    const code = /** @type {number} */ (char.codePointAt(0));
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) continue;
    fail('INVALID_OPTION', `${name} has "${char}", which the standard fonts cannot draw. Only Latin text is supported for now.`);
  }
}

/**
 * Check a style once, up front, so a bad option fails before any work is done.
 *
 * @param {TextStyle} style
 * @param {{ size: number, color?: string }} defaults
 */
export function resolveStyle(style, defaults) {
  const font = style.font ?? 'Helvetica';
  if (!STANDARD_FONTS.includes(font)) fail('INVALID_OPTION', `font must be one of ${STANDARD_FONTS.join(', ')}.`);
  const size = numberIn(style.size ?? defaults.size, 'size', 1, 1000);
  const argb = argbColor(style.color ?? defaults.color ?? '#000000', 'color');
  const opacity = numberIn(style.opacity ?? 1, 'opacity', 0, 1);
  return {
    font,
    size,
    red: (argb >>> 16) & 0xff,
    green: (argb >>> 8) & 0xff,
    blue: argb & 0xff,
    alpha: Math.round(opacity * 255),
  };
}

/**
 * @param {Placement} p
 */
export function checkPlacement(p) {
  checkLatin(p.text, 'text');
  if (p.position !== undefined && !POSITIONS.includes(p.position)) fail('INVALID_OPTION', `position must be one of ${POSITIONS.join(', ')}.`);
  if (p.at !== undefined && (!Number.isFinite(p.at?.x) || !Number.isFinite(p.at?.y))) fail('INVALID_OPTION', 'at must be { x, y } in points.');
  if (p.margin !== undefined) numberIn(p.margin, 'margin', 0, 10_000);
  if (p.angle !== undefined) numberIn(p.angle, 'angle', -360, 360);
}

/**
 * Open the document and, for each selected page, draw whatever `placements` returns.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ pages?: import('../modify.js').PageSelection, password?: string }} options
 * @param {ReturnType<typeof resolveStyle>} style
 * @param {(page: number, index: number, selected: number) => Placement[]} placements
 *   page is the page number; index counts the selected pages from 0
 */
export async function stamp(input, options, style, placements) {
  return modify(input, options, (pdf, doc) => {
    const font = pdf.fn.FPDFText_LoadStandardFont(doc, style.font);
    if (!font) fail('ENGINE_ERROR', `Could not load ${style.font}.`);
    try {
      const pages = selectPages(options.pages, pdf.fn.FPDF_GetPageCount(doc));
      pages.forEach((number, index) => {
        const items = placements(number, index, pages.length).filter((p) => p.text !== '');
        if (!items.length) return;
        pdf.withPage(doc, number - 1, (page) => {
          for (const item of items) drawText(pdf, doc, page, font, style, item);
          if (!pdf.fn.FPDFPage_GenerateContent(page)) fail('ENGINE_ERROR', `Could not write page ${number}.`);
        });
      });
    } finally {
      pdf.fn.FPDFFont_Close(font);
    }
  });
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} page
 * @param {number} font
 * @param {ReturnType<typeof resolveStyle>} style
 * @param {Placement} item
 */
function drawText(pdf, doc, page, font, style, item) {
  const { fn } = pdf;
  const obj = fn.FPDFPageObj_CreateTextObj(doc, font, style.size);
  if (!obj) fail('ENGINE_ERROR', 'Could not create text.');
  const size = (item.text.length + 1) * 2;
  const ptr = pdf.malloc(size);
  try {
    pdf.wasm.stringToUTF16(item.text, ptr, size);
    fn.FPDFText_SetText(obj, ptr);
  } finally {
    pdf.free(ptr);
  }
  fn.FPDFPageObj_SetFillColor(obj, style.red, style.green, style.blue, style.alpha);

  // the text's own box, drawn at the origin before we move it
  const [left, bottom, right, top] = pdf.readFloats(4, (p) => fn.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
  const width = right - left;
  const height = top - bottom;

  const turns = fn.FPDFPage_GetRotation(page);
  const box = pdf.visibleBox(page);
  const shown = shownSize(box, turns);
  const theta = ((item.angle ?? 0) * Math.PI) / 180;
  // directions as shown, where y grows downwards
  const run = [Math.cos(theta), -Math.sin(theta)];
  const up = [-Math.sin(theta), -Math.cos(theta)];

  // the centre of the text's box as shown
  let cx;
  let cy;
  if (item.at) {
    cx = item.at.x + width / 2;
    cy = item.at.y + height / 2;
  } else {
    const margin = item.margin ?? 36;
    const [vertical, horizontal = 'center'] = (item.position ?? 'center').split('-');
    const reachX = (Math.abs(run[0]) * width + Math.abs(up[0]) * height) / 2;
    const reachY = (Math.abs(run[1]) * width + Math.abs(up[1]) * height) / 2;
    cx = horizontal === 'left' ? margin + reachX : horizontal === 'right' ? shown.width - margin - reachX : shown.width / 2;
    cy = vertical === 'top' ? margin + reachY : vertical === 'bottom' ? shown.height - margin - reachY : shown.height / 2;
  }
  // where the text's origin goes, as shown
  const midX = (left + right) / 2;
  const midY = (bottom + top) / 2;
  const sx = cx - midX * run[0] - midY * up[0];
  const sy = cy - midX * run[1] - midY * up[1];

  // into page space: turn by the shown angle plus the page's rotation, then move into place
  const [px, py] = shownPointToPage(box, turns, sx, sy);
  const total = theta + (turns * Math.PI) / 2;
  const cos = Math.cos(total);
  const sin = Math.sin(total);
  fn.FPDFPageObj_Transform(obj, cos, sin, -sin, cos, px, py);

  if (item.behind) fn.FPDFPageObj_SetBlendMode(obj, 'Multiply');
  fn.FPDFPage_InsertObject(page, obj);
}
