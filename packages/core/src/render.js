import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { argbColor, numberIn } from './options.js';
import { encodePng } from './png.js';
import { fail } from './errors.js';
import { selectPages } from './modify.js';

// FPDF_RenderPageBitmap flags
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10; // RGBA instead of BGRA

export const DEFAULT_MAX_PIXELS = 40_000_000; // about a letter page at 700 dpi

/**
 * @typedef {object} RenderOptions
 * @property {number} [page]        1-based, default 1
 * @property {number} [dpi]         default 96; 72 dpi is one pixel per point
 * @property {number} [width]       fit to this many pixels wide instead of using dpi
 * @property {'png' | 'rgba'} [format]  default "png"
 * @property {string} [background]  "#rrggbb", "#rrggbbaa" or "transparent"; default white
 * @property {boolean} [annotations] draw annotations and form fields; default true
 * @property {number} [maxPixels]   refuse renders bigger than this; default 40 million
 * @property {string} [password]
 */

/**
 * @typedef {object} RenderedPage
 * @property {number} page
 * @property {number} width   pixels
 * @property {number} height  pixels
 * @property {'png' | 'rgba'} format
 * @property {Uint8Array} data  PNG file bytes, or width * height * 4 RGBA bytes
 */

/**
 * Draw one page as an image. Page rotation is applied, so the image looks like the page does
 * in a viewer.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {RenderOptions} [options]
 * @returns {Promise<RenderedPage>}
 */
export async function renderPage(input, options = {}) {
  const [page] = await render(input, [options.page ?? 1], options);
  return page;
}

/**
 * Draw several pages, opening the document once. Same options as renderPage, with `pages`
 * (every page if left out) instead of `page`.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {Omit<RenderOptions, 'page'> & { pages?: import('./modify.js').PageSelection }} [options]
 * @returns {Promise<RenderedPage[]>}
 */
export async function renderPages(input, options = {}) {
  return render(input, options.pages, options);
}

/**
 * Small PNG previews of pages, `width` pixels wide (default 200).
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ pages?: import('./modify.js').PageSelection, width?: number, password?: string }} [options]
 * @returns {Promise<RenderedPage[]>}
 */
export async function thumbnails(input, options = {}) {
  return render(input, options.pages, { width: options.width ?? 200, password: options.password });
}

/**
 * @param {import('./input.js').DocumentInput} input
 * @param {import('./modify.js').PageSelection | undefined} pages
 * @param {RenderOptions} options
 * @returns {Promise<RenderedPage[]>}
 */
async function render(input, pages, options) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;
  const format = options.format ?? 'png';
  if (format !== 'png' && format !== 'rgba') fail('INVALID_OPTION', 'format must be "png" or "rgba".');
  const background = argbColor(options.background ?? '#ffffff', 'background');
  const maxPixels = numberIn(options.maxPixels ?? DEFAULT_MAX_PIXELS, 'maxPixels', 1, 1e9);
  const flags = FPDF_REVERSE_BYTE_ORDER | (options.annotations === false ? 0 : FPDF_ANNOT);

  return pdf.withDocument(bytes, options, (doc) => {
    const count = fn.FPDF_GetPageCount(doc);
    return selectPages(pages, count).map((number) => pdf.withPage(doc, number - 1, (page) => {
      const pointsWide = fn.FPDF_GetPageWidthF(page);
      const pointsHigh = fn.FPDF_GetPageHeightF(page);
      const scale = options.width !== undefined
        ? numberIn(options.width, 'width', 1, 100_000) / pointsWide
        : numberIn(options.dpi ?? 96, 'dpi', 1, 2400) / 72;
      const width = Math.max(1, Math.round(pointsWide * scale));
      const height = Math.max(1, Math.round(pointsHigh * scale));
      if (width * height > maxPixels) {
        fail('INVALID_OPTION', `A ${width} x ${height} render is over the ${maxPixels} pixel limit. Lower the dpi or raise maxPixels.`);
      }

      const rgba = drawPage(pdf, page, width, height, flags, background);
      return {
        page: number,
        width,
        height,
        format,
        data: format === 'png' ? encodePng(rgba, width, height) : rgba,
      };
    }));
  });
}

/**
 * Draw a loaded page, as shown, into RGBA pixels.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {number} width   pixels
 * @param {number} height  pixels
 * @param {number} flags   FPDF_RenderPageBitmap flags; RGBA order is always added
 * @param {number} background  ARGB
 * @returns {Uint8Array}
 */
export function drawPage(pdf, page, width, height, flags, background) {
  const { fn } = pdf;
  const bitmap = fn.FPDFBitmap_Create(width, height, 1);
  if (!bitmap) fail('ENGINE_ERROR', 'Out of engine memory for the page image.');
  try {
    // FillRect writes BGRA order even when rendering in RGBA, so swap red and blue here
    fn.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, swapRedBlue(background));
    fn.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags | FPDF_REVERSE_BYTE_ORDER);
    return copyPixels(pdf, bitmap, width, height);
  } finally {
    fn.FPDFBitmap_Destroy(bitmap);
  }
}

export { FPDF_ANNOT };

/** @param {number} argb */
function swapRedBlue(argb) {
  return ((argb & 0xff00ff00) | ((argb & 0xff) << 16) | ((argb >>> 16) & 0xff)) >>> 0;
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} bitmap
 * @param {number} width
 * @param {number} height
 */
function copyPixels(pdf, bitmap, width, height) {
  const stride = pdf.fn.FPDFBitmap_GetStride(bitmap);
  const start = pdf.fn.FPDFBitmap_GetBuffer(bitmap);
  const heap = pdf.wasm.HEAPU8;
  const rowBytes = width * 4;
  if (stride === rowBytes) return heap.slice(start, start + rowBytes * height);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    out.set(heap.subarray(start + y * stride, start + y * stride + rowBytes), y * rowBytes);
  }
  return out;
}
