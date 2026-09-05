// True redaction: what is under a redaction box is taken out of the file, not covered up.
// Text characters, image pixels and drawings under the boxes are removed, annotations and form
// fields there go, and an opaque box is drawn where they were. Every redaction is then checked
// against the saved file; a page that does not pass is replaced by a picture of itself.
import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { selectPages } from './modify.js';
import { shownRectToBox } from './geometry.js';
import { argbColor } from './options.js';
import { fail } from './errors.js';
import { withForm, withFormPage } from './forms.js';
import { drawPage } from './render.js';
import { encodePng } from './png.js';
import { unzlibSync } from 'fflate';

const REDACT = 28;
const WIDGET = 20;
const PAGEOBJ_PATH = 2;
const PAGEOBJ_FORM = 5;
const PAD = 0.5;
const RASTER_DPI = 200;

/** @typedef {[number, number, number, number]} Box  left, bottom, right, top, in page coordinates */

/**
 * @typedef {object} Area
 * @property {number} page
 * @property {number} x  points from the left, as shown
 * @property {number} y  points from the top, as shown
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} RedactOptions
 * @property {Area[]} [areas]  boxes to redact
 * @property {(string | RegExp)[]} [text]  words or patterns to find and redact on every page
 * @property {boolean} [ignoreCase]  for the strings in `text`
 * @property {import('./modify.js').PageSelection} [pages]  where to look for `text`; default all
 * @property {string} [color]  of the boxes, "#rrggbb"; default black
 * @property {boolean} [metadata]  also clear the title, author, subject and keywords and the XMP
 *   metadata, whether or not they hold a match. Matches are taken out of them either way.
 * @property {string} [password]
 * @property {(report: RedactionReport) => void} [onReport]
 */

/**
 * @typedef {object} RedactionReport
 * @property {number} boxes  how many boxes were drawn
 * @property {{ pattern: string, page: number, count: number }[]} matches
 * @property {number[]} rasterised  pages replaced by a picture because they did not pass
 * @property {{ page: number, count: number }[]} drawingsCrossing  drawings that pass under a box
 *   and out of it: the part under the box is covered, the rest is kept
 * @property {VerifyResult} verification  of the file that was returned
 */

/**
 * Redact areas and text for good, then check the result.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {RedactOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function redact(input, options = {}) {
  const areas = checkAreas(options.areas ?? []);
  const patterns = checkPatterns(options.text ?? [], options.ignoreCase);
  if (!areas.length && !patterns.length) fail('INVALID_OPTION', 'Give areas or text to redact.');
  const argb = argbColor(options.color ?? '#000000', 'color');
  const colour = [(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff];
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;

  /** @type {RedactionReport} */
  const report = { boxes: 0, matches: [], rasterised: [], drawingsCrossing: [], verification: { ok: true, problems: [] } };
  /** @type {Map<number, Box[]>} page index to boxes in page coordinates */
  const boxes = new Map();
  let out = pdf.withDocument(bytes, options, (doc) => {
    const count = fn.FPDF_GetPageCount(doc);
    for (const area of areas) {
      if (area.page > count) fail('PAGE_NOT_FOUND', `Page ${area.page} does not exist: the document has ${count} pages.`);
      const box = pdf.withPage(doc, area.page - 1, (page) => shownRectToBox(pdf.visibleBox(page), fn.FPDFPage_GetRotation(page), area));
      boxes.set(area.page - 1, [...(boxes.get(area.page - 1) ?? []), box]);
    }
    if (patterns.length) {
      for (const number of selectPages(options.pages, count)) {
        pdf.withPage(doc, number - 1, (page) => pdf.withTextPage(page, (textPage) => {
          for (const { pattern, label } of patterns) {
            const found = findText(pdf, textPage, pattern);
            if (found.length) {
              report.matches.push({ pattern: label, page: number, count: found.length });
              boxes.set(number - 1, [...(boxes.get(number - 1) ?? []), ...found.flat()]);
            }
          }
        }));
      }
    }
    withForm(pdf, doc, (form) => {
      for (const [index, list] of boxes) {
        withFormPage(pdf, doc, form, index, (page) => {
          const padded = list.map(([l, b, r, t]) => /** @type {Box} */ ([l - PAD, b - PAD, r + PAD, t + PAD]));
          clearAnnotations(pdf, form, page, padded);
          for (const box of padded) addRedaction(pdf, page, box);
          if (!fn.EPDFPage_ApplyRedactions(page)) fail('ENGINE_ERROR', `Could not redact page ${index + 1}.`);
          const crossing = removeDrawings(pdf, page, page, false, padded);
          if (crossing) report.drawingsCrossing.push({ page: index + 1, count: crossing });
          for (const box of padded) fillBox(pdf, page, box, colour);
          report.boxes += padded.length;
          if (!fn.FPDFPage_GenerateContent(page)) fail('ENGINE_ERROR', `Could not write page ${index + 1}.`);
        });
      }
    });
    if (options.metadata) for (const key of ['Title', 'Author', 'Subject', 'Keywords']) setMeta(pdf, doc, key, '');
    if (patterns.length) scrubDetails(pdf, doc, patterns);
    return pdf.save(doc);
  });
  out = await scrubXmp(out, patterns, options.metadata === true);

  const check = { boxes, patterns, password: options.password, color: colour };
  let verification = await verify(out, check);
  const failing = [...new Set(verification.problems.filter((p) => p.page && RASTER_FIXES.has(p.code)).map((p) => /** @type {number} */ (p.page)))];
  if (failing.length) {
    out = await rasterise(out, failing, options.password);
    report.rasterised = failing;
    verification = await verify(out, check);
  }
  report.verification = verification;
  options.onReport?.(report);
  return out;
}

// problems a picture of the page fixes
const RASTER_FIXES = new Set(['TEXT_UNDER_BOX', 'TEXT_STILL_THERE']);

/**
 * @typedef {object} VerifyProblem
 * @property {'TEXT_UNDER_BOX' | 'TEXT_STILL_THERE' | 'BOX_MISSING' | 'ANNOTATION_UNDER_BOX' | 'IN_METADATA' | 'IN_BOOKMARKS' | 'IN_FORM_VALUES' | 'IN_FILE' | 'OLD_REVISIONS'} code
 * @property {string} message
 * @property {number} [page]
 */

/** @typedef {{ ok: boolean, problems: VerifyProblem[] }} VerifyResult */

/**
 * Check a redacted file: no characters under the boxes, no match for the patterns anywhere
 * (page text, metadata, bookmarks, form values, or any stream in the file once decompressed),
 * no older revisions, and the boxes are drawn.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ areas?: Area[], text?: (string | RegExp)[], ignoreCase?: boolean, color?: string, password?: string }} [options]
 * @returns {Promise<VerifyResult>}
 */
export async function verifyRedaction(input, options = {}) {
  const areas = checkAreas(options.areas ?? []);
  const patterns = checkPatterns(options.text ?? [], options.ignoreCase);
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  /** @type {Map<number, Box[]>} */
  const boxes = new Map();
  pdf.withDocument(bytes, options, (doc) => {
    for (const area of areas) {
      const box = pdf.withPage(doc, area.page - 1, (page) => shownRectToBox(pdf.visibleBox(page), pdf.fn.FPDFPage_GetRotation(page), area));
      boxes.set(area.page - 1, [...(boxes.get(area.page - 1) ?? []), box]);
    }
  });
  const argb = options.color === undefined ? null : argbColor(options.color, 'color');
  const color = argb === null ? null : [(argb >>> 16) & 0xff, (argb >>> 8) & 0xff, argb & 0xff];
  return verify(bytes, { boxes, patterns, password: options.password, color });
}

/**
 * @param {Uint8Array} bytes
 * @param {{ boxes: Map<number, Box[]>, patterns: { pattern: RegExp, label: string }[], password?: string, color: number[] | null }} check
 * @returns {Promise<VerifyResult>}
 */
async function verify(bytes, { boxes, patterns, password, color }) {
  const pdf = await engine();
  const { fn } = pdf;
  /** @type {VerifyProblem[]} */
  const problems = [];
  const test = (/** @type {string} */ text) => patterns.find(({ pattern }) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text));
  pdf.withDocument(bytes, { password }, (doc) => {
    for (let index = 0; index < fn.FPDF_GetPageCount(doc); index++) {
      pdf.withPage(doc, index, (page) => {
        const list = boxes.get(index) ?? [];
        pdf.withTextPage(page, (textPage) => {
          if (list.length && charsUnder(pdf, textPage, list)) problems.push({ code: 'TEXT_UNDER_BOX', page: index + 1, message: `Text is still under a box on page ${index + 1}.` });
          if (patterns.length) {
            const text = readAll(pdf, textPage);
            const hit = test(text);
            if (hit) problems.push({ code: 'TEXT_STILL_THERE', page: index + 1, message: `"${hit.label}" is still on page ${index + 1}.` });
          }
        });
        for (let a = 0; a < fn.FPDFPage_GetAnnotCount(page); a++) {
          const annot = fn.FPDFPage_GetAnnot(page, a);
          try {
            const [l, t, r, b] = pdf.readFloats(4, (p) => fn.FPDFAnnot_GetRect(annot, p));
            if (list.some((box) => overlaps(box, [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)]))) {
              problems.push({ code: 'ANNOTATION_UNDER_BOX', page: index + 1, message: `An annotation is still under a box on page ${index + 1}.` });
            }
          } finally {
            fn.FPDFPage_CloseAnnot(annot);
          }
        }
        if (color && list.length && !boxesDrawn(pdf, page, list, color)) problems.push({ code: 'BOX_MISSING', page: index + 1, message: `A box on page ${index + 1} is not drawn solid.` });
      });
    }
    if (patterns.length) {
      for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) {
        const value = pdf.readUtf16((p, l) => fn.FPDF_GetMetaText(doc, key, p, l));
        const hit = value && test(value);
        if (hit) problems.push({ code: 'IN_METADATA', message: `"${hit.label}" is in the document's ${key.toLowerCase()}.` });
      }
      for (const title of bookmarkTitles(pdf, doc)) {
        const hit = test(title);
        if (hit) problems.push({ code: 'IN_BOOKMARKS', message: `"${hit.label}" is in a bookmark.` });
      }
      withForm(pdf, doc, (form) => {
        for (let index = 0; index < fn.FPDF_GetPageCount(doc); index++) {
          withFormPage(pdf, doc, form, index, (page) => {
            for (let a = 0; a < fn.FPDFPage_GetAnnotCount(page); a++) {
              const annot = fn.FPDFPage_GetAnnot(page, a);
              try {
                if (fn.FPDFAnnot_GetSubtype(annot) !== WIDGET) continue;
                const hit = test(pdf.readUtf16((p, l) => fn.FPDFAnnot_GetFormFieldValue(form, annot, p, l)));
                if (hit) problems.push({ code: 'IN_FORM_VALUES', page: index + 1, message: `"${hit.label}" is in a form field on page ${index + 1}.` });
              } finally {
                fn.FPDFPage_CloseAnnot(annot);
              }
            }
          });
        }
      });
    }
  });
  if (patterns.length) {
    const raw = rawHit(bytes, patterns);
    if (raw) problems.push({ code: 'IN_FILE', message: `"${raw}" is still inside the file, in a stream no page shows.` });
  }
  if (revisions(bytes) > 1) problems.push({ code: 'OLD_REVISIONS', message: 'The file keeps older revisions, which can hold what was redacted.' });
  return { ok: problems.length === 0, problems };
}

/**
 * Where a pattern is on a page, as boxes in page coordinates, one list per match.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 * @param {RegExp} pattern  global
 * @returns {Box[][]}
 */
function findText(pdf, textPage, pattern) {
  const { fn } = pdf;
  const text = readAll(pdf, textPage);
  /** @type {Box[][]} */
  const out = [];
  for (const match of text.matchAll(pattern)) {
    if (!match[0].length) continue;
    const start = /** @type {number} */ (match.index);
    const rects = fn.FPDFText_CountRects(textPage, start, match[0].length);
    /** @type {Box[]} */
    const found = [];
    for (let i = 0; i < rects; i++) {
      const [l, t, r, b] = pdf.readDoubles(4, (p) => fn.FPDFText_GetRect(textPage, i, p, p + 8, p + 16, p + 24));
      found.push([Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)]);
    }
    if (found.length) out.push(found);
  }
  return out;
}

/**
 * The page's text with one character for each of PDFium's, so indexes line up.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 */
function readAll(pdf, textPage) {
  const count = pdf.fn.FPDFText_CountChars(textPage);
  if (count <= 0) return '';
  const ptr = pdf.malloc((count + 1) * 2);
  try {
    pdf.fn.FPDFText_GetText(textPage, 0, count, ptr);
    return pdf.wasm.UTF16ToString(ptr, (count + 1) * 2);
  } finally {
    pdf.free(ptr);
  }
}

/**
 * Annotations over a box go; a form field there is emptied first, so its value does not stay
 * in the form after its widget is gone.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} form
 * @param {number} page
 * @param {Box[]} list
 */
function clearAnnotations(pdf, form, page, list) {
  const { fn } = pdf;
  for (let a = fn.FPDFPage_GetAnnotCount(page) - 1; a >= 0; a--) {
    const annot = fn.FPDFPage_GetAnnot(page, a);
    let remove = false;
    try {
      const [l, t, r, b] = pdf.readFloats(4, (p) => fn.FPDFAnnot_GetRect(annot, p));
      remove = list.some((box) => overlaps(box, [Math.min(l, r), Math.min(t, b), Math.max(l, r), Math.max(t, b)]));
      if (remove && fn.FPDFAnnot_GetSubtype(annot) === WIDGET) pdf.withWideString('', (v) => fn.EPDFAnnot_SetFormFieldValue(form, annot, v));
    } finally {
      fn.FPDFPage_CloseAnnot(annot);
    }
    if (remove) fn.FPDFPage_RemoveAnnot(page, a);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {Box} box
 */
function addRedaction(pdf, page, box) {
  const { fn } = pdf;
  const annot = fn.FPDFPage_CreateAnnot(page, REDACT);
  if (!annot) fail('ENGINE_ERROR', 'Could not mark an area for redaction.');
  const [l, b, r, t] = box;
  const ptr = pdf.malloc(32);
  try {
    // FS_RECTF is left, top, right, bottom; FS_QUADPOINTSF goes top left, top right, bottom left, bottom right
    [l, t, r, b].forEach((v, i) => pdf.wasm.setValue(ptr + i * 4, v, 'float'));
    fn.FPDFAnnot_SetRect(annot, ptr);
    [l, t, r, t, l, b, r, b].forEach((v, i) => pdf.wasm.setValue(ptr + i * 4, v, 'float'));
    fn.FPDFAnnot_AppendAttachmentPoints(annot, ptr);
  } finally {
    pdf.free(ptr);
    fn.FPDFPage_CloseAnnot(annot);
  }
}

/**
 * Drawings wholly under a box are taken out (text drawn as outlines is still text). Drawings
 * that only pass under a box are covered by it and counted.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {number} holder
 * @param {boolean} form
 * @param {Box[]} list
 * @returns {number} drawings that cross a box's edge
 */
function removeDrawings(pdf, page, holder, form, list) {
  const { fn } = pdf;
  let crossing = 0;
  const count = form ? fn.FPDFFormObj_CountObjects(holder) : fn.FPDFPage_CountObjects(holder);
  for (let k = count - 1; k >= 0; k--) {
    const obj = form ? fn.FPDFFormObj_GetObject(holder, k) : fn.FPDFPage_GetObject(holder, k);
    const type = fn.FPDFPageObj_GetType(obj);
    if (type === PAGEOBJ_FORM) {
      crossing += removeDrawings(pdf, page, obj, true, list);
      continue;
    }
    if (type !== PAGEOBJ_PATH) continue;
    const [l, b, r, t] = pdf.readFloats(4, (p) => fn.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12));
    const bounds = /** @type {Box} */ ([l, b, r, t]);
    if (list.some((box) => inside(bounds, box))) {
      if (form ? fn.FPDFFormObj_RemoveObject(holder, obj) : fn.FPDFPage_RemoveObject(holder, obj)) fn.FPDFPageObj_Destroy(obj);
    } else if (list.some((box) => overlaps(box, bounds))) {
      crossing++;
    }
  }
  return crossing;
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {Box} box
 * @param {number[]} colour
 */
function fillBox(pdf, page, [l, b, r, t], colour) {
  const { fn } = pdf;
  const rect = fn.FPDFPageObj_CreateNewRect(l, b, r - l, t - b);
  fn.FPDFPageObj_SetFillColor(rect, colour[0], colour[1], colour[2], 255);
  fn.FPDFPath_SetDrawMode(rect, 1, 0);
  fn.FPDFPage_InsertObject(page, rect);
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {string} key
 * @param {string} value
 */
function setMeta(pdf, doc, key, value) {
  pdf.withWideString(value, (v) => pdf.fn.EPDF_SetMetaText(doc, key, v));
}

/**
 * Take the matches out of the document's information (title, author and so on) and out of
 * bookmark titles, keeping the rest of each.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {{ pattern: RegExp, label: string }[]} patterns
 */
function scrubDetails(pdf, doc, patterns) {
  const { fn } = pdf;
  const scrub = (/** @type {string} */ text) => patterns.reduce((t, { pattern }) => t.replace(pattern, ''), text).replace(/\s{2,}/g, ' ').trim();
  for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) {
    const value = pdf.readUtf16((p, l) => fn.FPDF_GetMetaText(doc, key, p, l));
    const clean = value && scrub(value);
    if (value && clean !== value) setMeta(pdf, doc, key, clean);
  }
  /** @param {number} item @param {number} depth */
  const walk = (item, depth) => {
    for (let b = item; b && depth < 64; b = fn.FPDFBookmark_GetNextSibling(doc, b)) {
      const title = pdf.readUtf16((p, l) => fn.FPDFBookmark_GetTitle(b, p, l));
      const clean = scrub(title);
      if (clean !== title) pdf.withWideString(clean, (v) => fn.EPDFBookmark_SetTitle(b, v));
      walk(fn.FPDFBookmark_GetFirstChild(doc, b), depth + 1);
    }
  };
  walk(fn.FPDFBookmark_GetFirstChild(doc, 0), 0);
}

/**
 * The XMP metadata stream repeats the document's information and more. PDFium cannot edit it,
 * so when it holds a match, or all metadata is to go, it is removed. Encrypted files are left:
 * rewriting them would lose their encryption; verification reports what is left.
 *
 * @param {Uint8Array} bytes
 * @param {{ pattern: RegExp, label: string }[]} patterns
 * @param {boolean} all
 */
async function scrubXmp(bytes, patterns, all) {
  if (!all && !patterns.length) return bytes;
  const { PDFDocument, PDFName, PDFRawStream } = await import('@cantoo/pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return bytes;
  }
  if (doc.isEncrypted) return bytes;
  const meta = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(meta instanceof PDFRawStream)) return bytes;
  let xml = '';
  try {
    xml = new TextDecoder().decode(meta.dict.has(PDFName.of('Filter')) ? unzlibSync(meta.getContents()) : meta.getContents());
  } catch {
    xml = '';
  }
  const hit = patterns.some(({ pattern }) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(xml));
  if (!all && !hit) return bytes;
  doc.catalog.delete(PDFName.of('Metadata'));
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/**
 * Is any visible character's centre under a box?
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} textPage
 * @param {Box[]} list
 */
function charsUnder(pdf, textPage, list) {
  const { fn } = pdf;
  const count = fn.FPDFText_CountChars(textPage);
  for (let i = 0; i < count; i++) {
    const code = fn.FPDFText_GetUnicode(textPage, i);
    if (code <= 32 || fn.FPDFText_IsGenerated(textPage, i) === 1) continue;
    const [l, r, b, t] = pdf.readDoubles(4, (p) => fn.FPDFText_GetCharBox(textPage, i, p, p + 8, p + 16, p + 24));
    const x = (l + r) / 2;
    const y = (b + t) / 2;
    if (list.some(([bl, bb, br, bt]) => x >= bl && x <= br && y >= bb && y <= bt)) return true;
  }
  return false;
}

/**
 * Are the boxes solid in their colour? The page is drawn unturned, so page coordinates map
 * straight onto pixels; edges are left out because of smoothing.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {Box[]} list
 * @param {number[]} colour
 */
function boxesDrawn(pdf, page, list, colour) {
  const { fn } = pdf;
  const turns = fn.FPDFPage_GetRotation(page);
  if (turns) fn.FPDFPage_SetRotation(page, 0);
  try {
    const [x0, y0, x1, y1] = pdf.visibleBox(page);
    const scale = 72 / 72;
    const width = Math.max(1, Math.round((x1 - x0) * scale));
    const height = Math.max(1, Math.round((y1 - y0) * scale));
    const rgba = drawPage(pdf, page, width, height, 0, 0xffffffff);
    return list.every(([l, b, r, t]) => {
      for (let y = Math.ceil((y1 - t) * scale) + 1; y < Math.floor((y1 - b) * scale) - 1; y++) {
        for (let x = Math.ceil((l - x0) * scale) + 1; x < Math.floor((r - x0) * scale) - 1; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const o = (y * width + x) * 4;
          if (Math.abs(rgba[o] - colour[0]) > 8 || Math.abs(rgba[o + 1] - colour[1]) > 8 || Math.abs(rgba[o + 2] - colour[2]) > 8) return false;
        }
      }
      return true;
    });
  } finally {
    if (turns) fn.FPDFPage_SetRotation(page, turns);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @returns {string[]}
 */
function bookmarkTitles(pdf, doc) {
  const { fn } = pdf;
  /** @type {string[]} */
  const titles = [];
  /** @param {number} item @param {number} depth */
  const walk = (item, depth) => {
    for (let b = item; b && titles.length < 10_000 && depth < 64; b = fn.FPDFBookmark_GetNextSibling(doc, b)) {
      titles.push(pdf.readUtf16((p, l) => fn.FPDFBookmark_GetTitle(b, p, l)));
      walk(fn.FPDFBookmark_GetFirstChild(doc, b), depth + 1);
    }
  };
  walk(fn.FPDFBookmark_GetFirstChild(doc, 0), 0);
  return titles;
}

/**
 * Look through every stream in the file, decompressed where it can be, for the patterns: text
 * that no page shows can still be in the file.
 *
 * @param {Uint8Array} bytes
 * @param {{ pattern: RegExp, label: string }[]} patterns
 */
function rawHit(bytes, patterns) {
  const latin = latin1(bytes);
  const texts = [latin];
  const stream = /stream\r?\n/g;
  for (let m = stream.exec(latin); m; m = stream.exec(latin)) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    try {
      texts.push(latin1(unzlibSync(bytes.subarray(start, end).subarray(0, end - start))));
    } catch {
      // not Flate, or damaged: the plain bytes are searched above
    }
    stream.lastIndex = end;
  }
  // strings written in hex, as many generators write text and as document information is
  // often stored (UTF-16 when it starts with FEFF)
  for (const text of [...texts]) texts.push(text.replace(/<([0-9A-Fa-f\s]{2,})>/g, (_, hex) => decodeHex(hex)));
  for (const text of texts) {
    for (const { pattern, label } of patterns) {
      if (new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text)) return label;
    }
  }
  return null;
}

/** @param {string} hex */
function decodeHex(hex) {
  const clean = hex.replace(/\s/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  }
  return String.fromCharCode(...bytes);
}

/** @param {Uint8Array} bytes */
function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

/** @param {Uint8Array} bytes */
function revisions(bytes) {
  return (latin1(bytes).match(/%%EOF/g) ?? []).length;
}

/**
 * Replace pages with a picture of themselves, drawn unturned so it fits the page's own space.
 *
 * @param {Uint8Array} bytes
 * @param {number[]} pages  from 1
 * @param {string | undefined} password
 */
export async function rasterise(bytes, pages, password) {
  const pdf = await engine();
  const { fn } = pdf;
  return pdf.withDocument(bytes, { password }, (doc) => {
    for (const number of pages) {
      pdf.withPage(doc, number - 1, (page) => {
        const turns = fn.FPDFPage_GetRotation(page);
        fn.FPDFPage_SetRotation(page, 0);
        const [x0, y0, x1, y1] = pdf.visibleBox(page);
        const scale = RASTER_DPI / 72;
        const width = Math.max(1, Math.round((x1 - x0) * scale));
        const height = Math.max(1, Math.round((y1 - y0) * scale));
        const png = encodePng(drawPage(pdf, page, width, height, 0x01, 0xffffffff), width, height);
        for (let k = fn.FPDFPage_CountObjects(page) - 1; k >= 0; k--) {
          const obj = fn.FPDFPage_GetObject(page, k);
          fn.FPDFPage_RemoveObject(page, obj);
          fn.FPDFPageObj_Destroy(obj);
        }
        for (let a = fn.FPDFPage_GetAnnotCount(page) - 1; a >= 0; a--) fn.FPDFPage_RemoveAnnot(page, a);
        const image = fn.FPDFPageObj_NewImageObj(doc);
        const ptr = pdf.malloc(png.length);
        try {
          pdf.wasm.HEAPU8.set(png, ptr);
          if (!fn.EPDFImageObj_SetPng(page, 0, image, ptr, png.length)) fail('ENGINE_ERROR', `Could not draw page ${number} as a picture.`);
        } finally {
          pdf.free(ptr);
        }
        fn.FPDFImageObj_SetMatrix(image, x1 - x0, 0, 0, y1 - y0, x0, y0);
        fn.FPDFPage_InsertObject(page, image);
        fn.FPDFPage_SetRotation(page, turns);
        if (!fn.FPDFPage_GenerateContent(page)) fail('ENGINE_ERROR', `Could not write page ${number}.`);
      });
    }
    return pdf.save(doc);
  });
}

/** @param {Box} a @param {Box} b */
function overlaps(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** @param {Box} a  inside @param {Box} b */
function inside(a, b) {
  return a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
}

/** @param {unknown} areas */
function checkAreas(areas) {
  if (!Array.isArray(areas)) fail('INVALID_OPTION', 'areas must be a list of { page, x, y, width, height }.');
  for (const a of areas) {
    if (!a || !Number.isInteger(a.page) || a.page < 1 || ![a.x, a.y, a.width, a.height].every(Number.isFinite) || a.width <= 0 || a.height <= 0) {
      fail('INVALID_OPTION', 'Each area needs page (from 1), x, y, width and height, in points.');
    }
  }
  return /** @type {Area[]} */ (areas);
}

/**
 * @param {unknown} list
 * @param {boolean | undefined} ignoreCase
 * @returns {{ pattern: RegExp, label: string }[]}
 */
function checkPatterns(list, ignoreCase) {
  if (!Array.isArray(list)) fail('INVALID_OPTION', 'text must be a list of strings or regular expressions.');
  return list.map((item) => {
    if (item instanceof RegExp) return { pattern: new RegExp(item.source, item.flags.includes('g') ? item.flags : `${item.flags}g`), label: String(item) };
    if (typeof item !== 'string' || !item) fail('INVALID_OPTION', 'text must be a list of non-empty strings or regular expressions.');
    return { pattern: new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'gi' : 'g'), label: /** @type {string} */ (item) };
  });
}
