import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { pageNumber } from './options.js';
import { fail } from './errors.js';

/**
 * @typedef {object} PageText
 * @property {number} page
 * @property {string} text  lines separated by "\n"
 */

/**
 * A word on the page as a viewer shows it: points, origin at the top left, rotation applied.
 * Multiply by dpi / 72 to land on a rendered image.
 *
 * @typedef {object} Word
 * @property {string} text
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} PageWords
 * @property {number} page
 * @property {number} width   page width in points, as shown
 * @property {number} height  page height in points, as shown
 * @property {Word[]} words
 */

/**
 * The text of each page, in the order the PDF stores it.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ pages?: number[], password?: string }} [options]
 * @returns {Promise<PageText[]>}
 */
export async function extractText(input, options = {}) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) =>
    selectPages(options.pages, pdf.fn.FPDF_GetPageCount(doc)).map((number) =>
      pdf.withPage(doc, number - 1, (page) => {
        unrotate(pdf, page);
        return pdf.withTextPage(page, (textPage) => ({ page: number, text: pageText(pdf, textPage) }));
      }),
    ),
  );
}

/**
 * Every word on the given pages, with its box.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ pages?: number[], password?: string }} [options]
 * @returns {Promise<PageWords[]>}
 */
export async function extractWords(input, options = {}) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) =>
    selectPages(options.pages, pdf.fn.FPDF_GetPageCount(doc)).map((number) =>
      pdf.withPage(doc, number - 1, (page) => {
        const shown = { width: pdf.fn.FPDF_GetPageWidthF(page), height: pdf.fn.FPDF_GetPageHeightF(page) };
        const rotation = unrotate(pdf, page);
        return pdf.withTextPage(page, (textPage) => ({
          page: number,
          width: round(shown.width),
          height: round(shown.height),
          words: pageWords(pdf, page, textPage, shown, rotation),
        }));
      }),
    ),
  );
}

/**
 * @param {number[] | undefined} pages
 * @param {number} pageCount
 */
function selectPages(pages, pageCount) {
  if (pages === undefined) return Array.from({ length: pageCount }, (_, i) => i + 1);
  if (!Array.isArray(pages)) fail('INVALID_OPTION', 'pages must be an array of page numbers.');
  return pages.map((n) => pageNumber(n, 'pages', pageCount));
}

/**
 * PDFium orders text as the page is shown, so on a page turned a quarter the lines come out
 * backwards. Reading it unturned gives the order it was written in. The document is only
 * changed in engine memory and is never saved here.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @returns {number} the rotation it had, in quarter turns
 */
function unrotate(pdf, page) {
  const rotation = pdf.fn.FPDFPage_GetRotation(page);
  if (rotation) pdf.fn.FPDFPage_SetRotation(page, 0);
  return rotation;
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 */
function pageText(pdf, textPage) {
  const count = pdf.fn.FPDFText_CountChars(textPage);
  if (count <= 0) return '';
  const ptr = pdf.malloc((count + 1) * 2);
  try {
    pdf.fn.FPDFText_GetText(textPage, 0, count, ptr);
    return pdf.wasm.UTF16ToString(ptr).replace(/\r\n?/g, '\n');
  } finally {
    pdf.free(ptr);
  }
}

// Device coordinates from FPDF_PageToDevice are integers, so map onto a page this many times
// bigger and divide back: 1/1000 of a point is far finer than anyone needs.
const PRECISION = 1000;

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page      with its rotation taken off
 * @param {number} textPage
 * @param {{ width: number, height: number }} shown  page size as shown
 * @param {number} rotation  quarter turns to put back when mapping boxes
 * @returns {Word[]}
 */
function pageWords(pdf, page, textPage, shown, rotation) {
  const { fn } = pdf;
  const count = fn.FPDFText_CountChars(textPage);
  const sizeX = Math.round(shown.width * PRECISION);
  const sizeY = Math.round(shown.height * PRECISION);
  const box = pdf.malloc(4 * 8 + 2 * 4); // four doubles, then two ints for device x, y
  const deviceX = box + 32;
  const deviceY = box + 36;

  /** @param {number} x  @param {number} y  @returns {[number, number]} */
  const toDevice = (x, y) => {
    fn.FPDF_PageToDevice(page, 0, 0, sizeX, sizeY, rotation, x, y, deviceX, deviceY);
    return [pdf.wasm.getValue(deviceX, 'i32') / PRECISION, pdf.wasm.getValue(deviceY, 'i32') / PRECISION];
  };

  /** @type {Word[]} */
  const words = [];
  let text = '';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const flush = () => {
    if (text) words.push({ text, x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) });
    text = '';
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
  };

  try {
    for (let i = 0; i < count; i++) {
      const char = String.fromCodePoint(fn.FPDFText_GetUnicode(textPage, i));
      if (/\s/.test(char) || fn.FPDFText_IsGenerated(textPage, i) === 1) {
        flush();
        continue;
      }
      // FPDFText_GetCharBox writes left, right, bottom, top
      if (!fn.FPDFText_GetCharBox(textPage, i, box, box + 8, box + 16, box + 24)) continue;
      const [left, right, bottom, top] = [0, 8, 16, 24].map((o) => pdf.wasm.getValue(box + o, 'double'));
      for (const [px, py] of [toDevice(left, bottom), toDevice(right, top)]) {
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      text += char;
    }
    flush();
    return words;
  } finally {
    pdf.free(box);
  }
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}
