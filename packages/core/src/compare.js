// Two versions of a document: what words changed, what pixels changed, and a report that shows
// both versions side by side with the changes marked.
import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { extractWords } from './text.js';
import { renderPages } from './render.js';
import { encodePng } from './png.js';
import { diffWords } from './diff.js';
import { shownSize } from './geometry.js';
import { fail } from './errors.js';
import { numberIn } from './options.js';

/**
 * @typedef {object} PlacedWord
 * @property {string} text
 * @property {number} page
 * @property {number} x  points from the left, as shown
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} TextChange
 * @property {'removed' | 'added' | 'changed'} type
 * @property {string} before  the words in the first document ("" when added)
 * @property {string} after   the words in the second ("" when removed)
 * @property {PlacedWord[]} beforeWords
 * @property {PlacedWord[]} afterWords
 */

/**
 * @typedef {object} TextComparison
 * @property {boolean} identical
 * @property {{ removed: number, added: number }} words  how many words went and came
 * @property {TextChange[]} changes
 */

/**
 * @typedef {object} CompareOptions
 * @property {string} [password]        for the first document
 * @property {string} [passwordB]       for the second
 * @property {boolean} [ignoreCase]
 * @property {boolean} [exact]  compare words exactly as written. By default punctuation at the
 *   start and end of a word is left out, so "month." matches "month,"; inside a word it counts,
 *   so "1,200" still differs from "1.200".
 */

/**
 * Which words were removed, added or changed between two versions, across the whole document:
 * text that moved to another page is not a change.
 *
 * @param {import('./input.js').DocumentInput} a
 * @param {import('./input.js').DocumentInput} b
 * @param {CompareOptions} [options]
 * @returns {Promise<TextComparison>}
 */
export async function compareText(a, b, options = {}) {
  const [wordsA, wordsB] = await Promise.all([
    placedWords(a, options.password),
    placedWords(b, options.passwordB ?? options.password),
  ]);
  /** @param {PlacedWord} w */
  const key = (w) => {
    const text = options.exact ? w.text : w.text.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '') || w.text;
    return options.ignoreCase ? text.toLowerCase() : text;
  };
  const runs = diffWords(wordsA.map(key), wordsB.map(key));
  /** @type {TextChange[]} */
  const changes = [];
  let removed = 0;
  let added = 0;
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k];
    if (run.type === 'same') continue;
    const next = runs[k + 1];
    const gone = run.type === 'removed' ? wordsA.slice(run.a, run.a + run.length) : [];
    const come = run.type === 'added' ? wordsB.slice(run.b, run.b + run.length)
      : next?.type === 'added' ? wordsB.slice(next.b, next.b + next.length) : [];
    if (run.type === 'removed' && next?.type === 'added') k++;
    removed += gone.length;
    added += come.length;
    changes.push({
      type: gone.length && come.length ? 'changed' : gone.length ? 'removed' : 'added',
      before: gone.map((w) => w.text).join(' '),
      after: come.map((w) => w.text).join(' '),
      beforeWords: gone,
      afterWords: come,
    });
  }
  return { identical: changes.length === 0, words: { removed, added }, changes };
}

/**
 * @param {import('./input.js').DocumentInput} input
 * @param {string | undefined} password
 * @returns {Promise<PlacedWord[]>}
 */
async function placedWords(input, password) {
  const pages = await extractWords(input, { password });
  return pages.flatMap((p) => p.words.map((w) => ({ ...w, page: p.page })));
}

/**
 * @typedef {object} PageDifference
 * @property {number} page
 * @property {number} changed  the share of pixels that differ, 0 to 1
 * @property {boolean} sameSize
 * @property {Uint8Array} [image]  a PNG of the first version, faded, with the differences in red
 */

/**
 * How much of each page looks different. Pages are compared by number; a page only one
 * version has counts as entirely changed.
 *
 * @param {import('./input.js').DocumentInput} a
 * @param {import('./input.js').DocumentInput} b
 * @param {{ dpi?: number, images?: boolean, password?: string, passwordB?: string }} [options]
 * @returns {Promise<PageDifference[]>}
 */
export async function compareVisual(a, b, options = {}) {
  const dpi = numberIn(options.dpi ?? 72, 'dpi', 18, 300);
  const [pagesA, pagesB] = await Promise.all([
    renderPages(a, { dpi, format: 'rgba', password: options.password }),
    renderPages(b, { dpi, format: 'rgba', password: options.passwordB ?? options.password }),
  ]);
  /** @type {PageDifference[]} */
  const out = [];
  for (let i = 0; i < Math.max(pagesA.length, pagesB.length); i++) {
    const [pa, pb] = [pagesA[i], pagesB[i]];
    if (!pa || !pb || pa.width !== pb.width || pa.height !== pb.height) {
      out.push({ page: i + 1, changed: 1, sameSize: false });
      continue;
    }
    const picture = options.images ? new Uint8Array(pa.data.length) : null;
    let changed = 0;
    for (let p = 0; p < pa.data.length; p += 4) {
      const differs = Math.abs(pa.data[p] - pb.data[p]) > 32 || Math.abs(pa.data[p + 1] - pb.data[p + 1]) > 32 || Math.abs(pa.data[p + 2] - pb.data[p + 2]) > 32;
      if (differs) changed++;
      if (picture) {
        if (differs) picture.set([220, 30, 30, 255], p);
        else {
          const grey = 255 - Math.round((255 - (pa.data[p] * 0.3 + pa.data[p + 1] * 0.59 + pa.data[p + 2] * 0.11)) * 0.35);
          picture.set([grey, grey, grey, 255], p);
        }
      }
    }
    out.push({
      page: i + 1,
      changed: Math.round((changed / (pa.width * pa.height)) * 1e6) / 1e6,
      sameSize: true,
      ...(picture ? { image: encodePng(picture, pa.width, pa.height) } : {}),
    });
  }
  return out;
}

const MARGIN = 24;
const HEADER = 28;
const RED = [220, 38, 38];
const GREEN = [22, 163, 74];

/**
 * A PDF that shows the two versions side by side, page by page, with removed words marked red
 * on the left and added words green on the right.
 *
 * @param {import('./input.js').DocumentInput} a
 * @param {import('./input.js').DocumentInput} b
 * @param {CompareOptions & { labels?: [string, string] }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function compareReport(a, b, options = {}) {
  const [bytesA, bytesB] = await Promise.all([toPdfBytes(a), toPdfBytes(b)]);
  const comparison = await compareText(bytesA, bytesB, options);
  const [left, right] = options.labels ?? ['Before', 'After'];
  if (typeof left !== 'string' || typeof right !== 'string') fail('INVALID_OPTION', 'labels must be two strings.');
  /** @type {Map<number, PlacedWord[]>} */
  const marksA = new Map();
  /** @type {Map<number, PlacedWord[]>} */
  const marksB = new Map();
  for (const change of comparison.changes) {
    for (const w of change.beforeWords) marksA.set(w.page, [...(marksA.get(w.page) ?? []), w]);
    for (const w of change.afterWords) marksB.set(w.page, [...(marksB.get(w.page) ?? []), w]);
  }
  const pdf = await engine();
  const { fn } = pdf;
  const docs = [{ bytes: bytesA, password: options.password }, { bytes: bytesB, password: options.passwordB ?? options.password }];
  return pdf.withDocuments(docs, ([docA, docB]) => pdf.withNewDocument((out) => {
    const font = fn.FPDFText_LoadStandardFont(out, 'Helvetica');
    const bold = fn.FPDFText_LoadStandardFont(out, 'Helvetica-Bold');
    try {
      const count = Math.max(fn.FPDF_GetPageCount(docA), fn.FPDF_GetPageCount(docB));
      for (let i = 0; i < count; i++) {
        const sides = [[docA, marksA, RED, left], [docB, marksB, GREEN, right]].map(([doc, marks, colour, label]) => {
          const d = /** @type {number} */ (doc);
          if (i >= fn.FPDF_GetPageCount(d)) return null;
          const [box, turns] = pdf.withPage(d, i, (p) => [pdf.visibleBox(p), fn.FPDFPage_GetRotation(p)]);
          return { doc: d, size: shownSize(box, turns), marks: /** @type {Map<number, PlacedWord[]>} */ (marks).get(i + 1) ?? [], colour: /** @type {number[]} */ (colour), label: /** @type {string} */ (label) };
        });
        const width = Math.max(...sides.map((s) => s?.size.width ?? 0));
        const height = Math.max(...sides.map((s) => s?.size.height ?? 0));
        const sheetW = 2 * width + 3 * MARGIN;
        const sheetH = height + 2 * MARGIN + HEADER;
        const sheet = fn.FPDFPage_New(out, i, sheetW, sheetH);
        if (!sheet) fail('ENGINE_ERROR', 'Could not make a report page.');
        try {
          sides.forEach((side, s) => {
            const x0 = MARGIN + s * (width + MARGIN);
            const top = MARGIN + HEADER;
            drawText(pdf, out, sheet, bold, 11, `${s ? right : left}, page ${i + 1}`, x0, sheetH - MARGIN - 12, [60, 60, 60]);
            if (!side) {
              drawText(pdf, out, sheet, font, 10, 'No such page in this version', x0, sheetH - top - 20, [120, 120, 120]);
              return;
            }
            // frame, then the page, then the marks over it
            drawRect(pdf, sheet, x0 - 0.5, sheetH - top - side.size.height - 0.5, side.size.width + 1, side.size.height + 1, [200, 200, 200], 255, false);
            const xobject = fn.FPDF_NewXObjectFromPage(out, side.doc, i);
            if (!xobject) fail('ENGINE_ERROR', `Could not copy page ${i + 1}.`);
            try {
              const form = fn.FPDF_NewFormObjectFromXObject(xobject);
              // PDFium copies the page as it is shown, origin at its bottom left
              fn.FPDFPageObj_Transform(form, 1, 0, 0, 1, x0, sheetH - top - side.size.height);
              fn.FPDFPage_InsertObject(sheet, form);
            } finally {
              fn.FPDF_CloseXObject(xobject);
            }
            for (const w of side.marks) {
              drawRect(pdf, sheet, x0 + w.x - 1, sheetH - top - w.y - w.height - 1, w.width + 2, w.height + 2, side.colour, 80, true);
            }
          });
          if (!fn.FPDFPage_GenerateContent(sheet)) fail('ENGINE_ERROR', 'Could not write a report page.');
        } finally {
          fn.FPDF_ClosePage(sheet);
        }
      }
    } finally {
      fn.FPDFFont_Close(font);
      fn.FPDFFont_Close(bold);
    }
    return pdf.save(out);
  }));
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {number} x  bottom left, sheet coordinates
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number[]} rgb
 * @param {number} alpha
 * @param {boolean} filled
 */
function drawRect(pdf, page, x, y, w, h, rgb, alpha, filled) {
  const { fn } = pdf;
  const rect = fn.FPDFPageObj_CreateNewRect(x, y, w, h);
  if (filled) {
    fn.FPDFPageObj_SetFillColor(rect, rgb[0], rgb[1], rgb[2], alpha);
    fn.FPDFPath_SetDrawMode(rect, 1, 0);
  } else {
    fn.FPDFPageObj_SetStrokeColor(rect, rgb[0], rgb[1], rgb[2], alpha);
    fn.FPDFPageObj_SetStrokeWidth(rect, 0.75);
    fn.FPDFPath_SetDrawMode(rect, 0, 1);
  }
  fn.FPDFPage_InsertObject(page, rect);
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} page
 * @param {number} font
 * @param {number} size
 * @param {string} text
 * @param {number} x  baseline start, sheet coordinates
 * @param {number} y
 * @param {number[]} rgb
 */
function drawText(pdf, doc, page, font, size, text, x, y, rgb) {
  const { fn } = pdf;
  const obj = fn.FPDFPageObj_CreateTextObj(doc, font, size);
  // the standard fonts draw Latin text only; anything else would come out as blanks
  pdf.withWideString(text.replace(/[^ -ÿ]/g, '?'), (p) => fn.FPDFText_SetText(obj, p));
  fn.FPDFPageObj_SetFillColor(obj, rgb[0], rgb[1], rgb[2], 255);
  fn.FPDFPageObj_Transform(obj, 1, 0, 0, 1, x, y);
  fn.FPDFPage_InsertObject(page, obj);
}
