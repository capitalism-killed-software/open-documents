// Drawing the pages of one PDF onto the pages of another. Each layer page becomes a form
// XObject. PDFium makes that XObject as the page is shown: rotation and crop box applied, origin
// at the bottom left of what a viewer shows. One matrix then takes it onto the target page as
// shown, so rotation and crop boxes on either side come out right.
import { engine } from '../engine/pdfium.js';
import { toPdfBytes } from '../input.js';
import { selectPages } from '../modify.js';
import { shownSize, shownPointToPage, pagePointToShown } from '../geometry.js';
import { fail } from '../errors.js';

const FITS = ['contain', 'stretch'];

/**
 * @typedef {object} OverlayOptions
 * @property {import('../modify.js').PageSelection} [pages]  pages to draw on; default all
 * @property {'contain' | 'stretch'} [fit]  contain (the default) keeps the layer's proportions
 *   and centres it; stretch fills the page exactly
 * @property {boolean} [behind]  draw the layer under the page's content instead of over it. The
 *   page's own content is moved into a form XObject so the layer can go first; a tagged PDF's
 *   structure tree no longer points into that content afterwards.
 * @property {string} [password]       for the document
 * @property {string} [layerPassword]  for the layer
 */

/**
 * Put the pages of another PDF over the pages of this one, or under them: a letterhead, a
 * background, a form printed on a template, a layer of invisible text.
 *
 * A one-page layer goes on every selected page. Otherwise the layer needs one page for each
 * selected page, used in order.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {import('../input.js').DocumentInput} layer  a PDF
 * @param {OverlayOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function overlay(input, layer, options = {}) {
  const fit = options.fit ?? 'contain';
  if (!FITS.includes(fit)) fail('INVALID_OPTION', `fit must be one of ${FITS.join(', ')}.`);
  const bytes = await toPdfBytes(input);
  const layerBytes = await toPdfBytes(layer);
  const pdf = await engine();
  const { fn } = pdf;
  const docs = [{ bytes, password: options.password }, { bytes: layerBytes, password: options.layerPassword }];
  return pdf.withDocuments(docs, ([doc, src]) => {
    const pages = selectPages(options.pages, fn.FPDF_GetPageCount(doc));
    const layerCount = fn.FPDF_GetPageCount(src);
    if (layerCount !== 1 && layerCount !== pages.length) {
      fail('INVALID_OPTION', `The layer has ${layerCount} pages for ${pages.length} selected pages. Give a one-page layer, or one page for each selected page.`);
    }
    /** @type {Map<number, number>} layer page index to XObject */
    const xobjects = new Map();
    /** @param {number} index */
    const xobject = (index) => {
      let x = xobjects.get(index);
      if (!x) {
        x = fn.FPDF_NewXObjectFromPage(doc, src, index);
        if (!x) fail('ENGINE_ERROR', `Could not read page ${index + 1} of the layer.`);
        xobjects.set(index, x);
      }
      return x;
    };
    try {
      pages.forEach((number, i) => {
        const from = layerCount === 1 ? 0 : i;
        const layerSize = pdf.withPage(src, from, (p) => shownSize(pdf.visibleBox(p), fn.FPDFPage_GetRotation(p)));
        // under the content: copy the page's content into a form before the page is changed
        const own = options.behind ? fn.FPDF_NewXObjectFromPage(doc, doc, number - 1) : 0;
        if (options.behind && !own) fail('ENGINE_ERROR', `Could not read page ${number}.`);
        try {
          pdf.withPage(doc, number - 1, (page) => {
            const box = pdf.visibleBox(page);
            const turns = fn.FPDFPage_GetRotation(page);
            const matrix = fitMatrix([0, 0, layerSize.width, layerSize.height], 0, box, turns, fit);
            const form = fn.FPDF_NewFormObjectFromXObject(xobject(from));
            if (!form) fail('ENGINE_ERROR', `Could not place the layer on page ${number}.`);
            fn.FPDFPageObj_Transform(form, ...matrix);
            if (own) {
              for (let k = fn.FPDFPage_CountObjects(page) - 1; k >= 0; k--) {
                const obj = fn.FPDFPage_GetObject(page, k);
                fn.FPDFPage_RemoveObject(page, obj);
                fn.FPDFPageObj_Destroy(obj);
              }
              fn.FPDFPage_InsertObject(page, form);
              // the page's own content comes back as shown too, so turn it back onto the page
              const shown = shownSize(box, turns);
              const content = fn.FPDF_NewFormObjectFromXObject(own);
              fn.FPDFPageObj_Transform(content, ...fitMatrix([0, 0, shown.width, shown.height], 0, box, turns, 'stretch'));
              fn.FPDFPage_InsertObject(page, content);
            } else {
              fn.FPDFPage_InsertObject(page, form);
            }
            if (!fn.FPDFPage_GenerateContent(page)) fail('ENGINE_ERROR', `Could not write page ${number}.`);
          });
        } finally {
          if (own) fn.FPDF_CloseXObject(own);
        }
      });
    } finally {
      for (const x of xobjects.values()) fn.FPDF_CloseXObject(x);
    }
    return pdf.save(doc);
  });
}

/**
 * The matrix that takes the layer page, as shown, onto the target page, as shown.
 *
 * @param {import('../geometry.js').Box} from  layer page's visible box
 * @param {number} fromTurns
 * @param {import('../geometry.js').Box} to    target page's visible box
 * @param {number} toTurns
 * @param {string} fit
 * @returns {[number, number, number, number, number, number]} a b c d e f
 */
function fitMatrix(from, fromTurns, to, toTurns, fit) {
  const a = shownSize(from, fromTurns);
  const b = shownSize(to, toTurns);
  if (a.width <= 0 || a.height <= 0) fail('INVALID_INPUT', 'The layer page has no size.');
  let sx = b.width / a.width;
  let sy = b.height / a.height;
  let ox = 0;
  let oy = 0;
  if (fit === 'contain') {
    sx = sy = Math.min(sx, sy);
    ox = (b.width - a.width * sx) / 2;
    oy = (b.height - a.height * sy) / 2;
  }
  /** @type {(x: number, y: number) => [number, number]} */
  const map = (x, y) => {
    const [u, v] = pagePointToShown(from, fromTurns, x, y);
    return shownPointToPage(to, toTurns, ox + u * sx, oy + v * sy);
  };
  const [e, f] = map(0, 0);
  const [ax, ay] = map(1, 0);
  const [cx, cy] = map(0, 1);
  return [ax - e, ay - f, cx - e, cy - f, e, f];
}
