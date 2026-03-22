import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { selectPages } from './modify.js';

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
 * @param {{ pages?: import('./modify.js').PageSelection, password?: string }} [options]
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
 * @param {{ pages?: import('./modify.js').PageSelection, password?: string }} [options]
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
 * One character as PDFium found it.
 *
 * @typedef {object} Glyph
 * @property {string} char
 * @property {[number, number, number, number]} tight  left, bottom, right, top of the ink
 * @property {number} angle  radians, anticlockwise
 * @property {number} u      position along the text's direction
 * @property {number} v      position across it (the baseline)
 * @property {number} along  how far the character reaches along the direction
 * @property {number} across how tall it is across the direction
 */

/**
 * Lines of words.
 *
 * PDFium decides where words and lines break, and it understands text at any angle, so its
 * decisions are kept, with one exception. Some generators (Chromium among them) write every
 * letter as its own text object, and PDFium then puts a line break between letters that sit on
 * one baseline. Such breaks are overruled: the letters join, or get a space when the gap
 * between them is wider than about a third of a letter.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 * @returns {Glyph[][][]} lines, of words, of characters
 */
function layout(pdf, textPage) {
  const { fn } = pdf;
  const count = fn.FPDFText_CountChars(textPage);
  const ptr = pdf.malloc(6 * 8 + 4 * 4); // four doubles for the ink box, two for the origin, four floats for the advance box
  /** @type {Glyph[][][]} */
  const lines = [];
  /** @type {Glyph[][]} */
  let line = [];
  /** @type {Glyph[]} */
  let word = [];
  /** @type {'none' | 'space' | 'line' | 'hard'} */
  let gap = 'none';
  /** @type {Glyph | null} */
  let last = null;
  const endWord = () => {
    if (word.length) line.push(word);
    word = [];
  };
  const endLine = () => {
    endWord();
    if (line.length) lines.push(line);
    line = [];
  };
  const read = (/** @type {number} */ offset, /** @type {'double' | 'float'} */ type) => pdf.wasm.getValue(ptr + offset, type);
  try {
    for (let i = 0; i < count; i++) {
      const char = String.fromCodePoint(fn.FPDFText_GetUnicode(textPage, i));
      const generated = fn.FPDFText_IsGenerated(textPage, i) === 1;
      if (char === '\r' || char === '\n') {
        gap = generated ? (gap === 'hard' ? 'hard' : 'line') : 'hard';
        continue;
      }
      if (/\s/.test(char)) {
        if (gap === 'none') gap = 'space';
        continue;
      }
      // FPDFText_GetCharBox writes left, right, bottom, top
      if (!fn.FPDFText_GetCharBox(textPage, i, ptr, ptr + 8, ptr + 16, ptr + 24)) continue;
      const tight = /** @type {[number, number, number, number]} */ ([read(0, 'double'), read(16, 'double'), read(8, 'double'), read(24, 'double')]);
      fn.FPDFText_GetCharOrigin(textPage, i, ptr + 32, ptr + 40);
      const ox = read(32, 'double');
      const oy = read(40, 'double');
      // FS_RECTF is left, top, right, bottom
      const hasLoose = fn.FPDFText_GetLooseCharBox(textPage, i, ptr + 48);
      const w = hasLoose ? Math.abs(read(56, 'float') - read(48, 'float')) : tight[2] - tight[0];
      const h = hasLoose ? Math.abs(read(52, 'float') - read(60, 'float')) : tight[3] - tight[1];
      const angle = Math.max(0, fn.FPDFText_GetCharAngle(textPage, i));
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      /** @type {Glyph} */
      const glyph = {
        char,
        tight,
        angle,
        u: ox * cos + oy * sin,
        v: -ox * sin + oy * cos,
        along: Math.abs(w * cos) + Math.abs(h * sin),
        across: Math.abs(w * sin) + Math.abs(h * cos),
      };
      if (last) {
        if (gap === 'line' && sameBaseline(last, glyph)) {
          const space = glyph.u - last.u - last.along;
          gap = space > 0.3 * Math.max(1, (last.along + glyph.along) / 2) ? 'space' : 'none';
        }
        if (gap === 'line' || gap === 'hard') endLine();
        else if (gap === 'space') endWord();
      }
      word.push(glyph);
      last = glyph;
      gap = 'none';
    }
    endLine();
    return lines;
  } finally {
    pdf.free(ptr);
  }
}

/**
 * Do two characters sit on one baseline, the second after the first?
 *
 * @param {Glyph} a
 * @param {Glyph} b
 */
function sameBaseline(a, b) {
  const turn = Math.abs(a.angle - b.angle);
  if (Math.min(turn, 2 * Math.PI - turn) > 0.02) return false;
  const height = Math.max(1, Math.min(a.across, b.across));
  return Math.abs(a.v - b.v) < 0.3 * height && b.u > a.u && b.u - a.u < a.along + 2 * height;
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 */
function pageText(pdf, textPage) {
  return layout(pdf, textPage)
    .map((line) => line.map((word) => word.map((g) => g.char).join('')).join(' '))
    .join('\n');
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
  const sizeX = Math.round(shown.width * PRECISION);
  const sizeY = Math.round(shown.height * PRECISION);
  const ptr = pdf.malloc(8);
  /** @param {number} x  @param {number} y  @returns {[number, number]} */
  const toDevice = (x, y) => {
    fn.FPDF_PageToDevice(page, 0, 0, sizeX, sizeY, rotation, x, y, ptr, ptr + 4);
    return [pdf.wasm.getValue(ptr, 'i32') / PRECISION, pdf.wasm.getValue(ptr + 4, 'i32') / PRECISION];
  };
  try {
    return layout(pdf, textPage).flat().map((glyphs) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const { tight: [l, b, r, t] } of glyphs) {
        for (const [x, y] of [toDevice(l, b), toDevice(r, t)]) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      return { text: glyphs.map((g) => g.char).join(''), x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
    });
  } finally {
    pdf.free(ptr);
  }
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}
