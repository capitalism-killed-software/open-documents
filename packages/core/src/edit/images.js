// Smaller files from pictures that are sharper than they need to be: each image drawn at more
// than the target resolution is scaled down and stored again as JPEG. Scans are where this pays.
import { modify } from '../modify.js';
import { numberIn } from '../options.js';
import { encode as encodeJpeg } from '../vendor/jpeg-encode.js';
import { encodePng } from '../png.js';

const PAGEOBJ_IMAGE = 3;
const PAGEOBJ_FORM = 5;
// colour spaces that come back from PDFium as plain grey or RGB without losing anything;
// CMYK, Lab, separations and DeviceN are left alone so print colours do not shift
const SAFE_COLOUR = new Set([1, 2, 4, 5, 7, 10]);

/**
 * @typedef {object} CompressImagesOptions
 * @property {number} [dpi]      target resolution, 50 to 600; default 150. Images at less than
 *   1.2 times this are left as they are.
 * @property {number} [quality]  JPEG quality, 10 to 100; default 75
 * @property {string} [password]
 */

/**
 * Scale down pictures drawn at more than `dpi` and store them as JPEG. Text, vector graphics and
 * pictures that are already small enough are untouched; an image is only replaced when the
 * result is smaller. Images with transparency are left alone: storing them again would lose
 * their masks.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {CompressImagesOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function compressImages(input, options = {}) {
  const dpi = numberIn(options.dpi ?? 150, 'dpi', 50, 600);
  const quality = Math.round(numberIn(options.quality ?? 75, 'quality', 10, 100));
  let replaced = 0;
  const out = await modify(input, options, (pdf, doc) => {
    const { fn } = pdf;
    for (let i = 0; i < fn.FPDF_GetPageCount(doc); i++) {
      pdf.withPage(doc, i, (page) => {
        const before = replaced;
        /** @param {number} holder @param {boolean} form */
        const walk = (holder, form) => {
          const count = form ? fn.FPDFFormObj_CountObjects(holder) : fn.FPDFPage_CountObjects(holder);
          for (let k = 0; k < count; k++) {
            const obj = form ? fn.FPDFFormObj_GetObject(holder, k) : fn.FPDFPage_GetObject(holder, k);
            const type = fn.FPDFPageObj_GetType(obj);
            if (type === PAGEOBJ_FORM) walk(obj, true);
            else if (type === PAGEOBJ_IMAGE && shrink(pdf, doc, page, obj, dpi, quality)) replaced++;
          }
        };
        walk(page, false);
        if (replaced > before) fn.FPDFPage_GenerateContent(page);
      });
    }
  });
  return out;
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} page
 * @param {number} obj
 * @param {number} dpi
 * @param {number} quality
 * @returns {boolean} whether the image was replaced
 */
function shrink(pdf, doc, page, obj, dpi, quality) {
  const { fn } = pdf;
  const meta = pdf.malloc(28);
  let width;
  let height;
  let shown;
  try {
    if (!fn.FPDFImageObj_GetImageMetadata(obj, page, meta)) return false;
    width = pdf.wasm.getValue(meta, 'i32') >>> 0;
    height = pdf.wasm.getValue(meta + 4, 'i32') >>> 0;
    shown = Math.min(pdf.wasm.getValue(meta + 8, 'float'), pdf.wasm.getValue(meta + 12, 'float'));
    const bits = pdf.wasm.getValue(meta + 16, 'i32');
    const colour = pdf.wasm.getValue(meta + 20, 'i32');
    if (bits <= 1 || !SAFE_COLOUR.has(colour) || !(shown > dpi * 1.2) || width < 16 || height < 16) return false;
  } finally {
    pdf.free(meta);
  }
  if (seeThrough(pdf, doc, page, obj)) return false;
  const scale = dpi / shown;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const source = readBitmap(pdf, obj);
  if (!source) return false;
  const small = downscale(source.rgba, source.width, source.height, w, h);
  const jpeg = encodeJpeg({ data: small, width: w, height: h }, quality).data;
  const png = encodePng(small, w, h);
  // text on white keeps better, and smaller, as PNG; photographs and real scans as JPEG
  const [bytes, setter] = png.length < jpeg.length ? [png, fn.EPDFImageObj_SetPng] : [jpeg, fn.EPDFImageObj_SetJpeg];
  // PDFium stores a PNG as plain Flate, a little bigger than the PNG itself: keep a margin
  if (bytes.length >= fn.FPDFImageObj_GetImageDataRaw(obj, 0, 0) * 0.9) return false;
  const ptr = pdf.malloc(bytes.length);
  try {
    pdf.wasm.HEAPU8.set(bytes, ptr);
    const ok = Boolean(setter(page, 0, obj, ptr, bytes.length));
    return ok;
  } finally {
    pdf.free(ptr);
  }
}

/**
 * Does the image let anything show through? PDFium says nothing about masks directly, but drawn
 * with its mask, a masked image has pixels that are not fully opaque.
 *
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} page
 * @param {number} obj
 */
function seeThrough(pdf, doc, page, obj) {
  const { fn } = pdf;
  const bitmap = fn.FPDFImageObj_GetRenderedBitmap(doc, page, obj);
  if (!bitmap) return true;
  try {
    if (fn.FPDFBitmap_GetFormat(bitmap) !== 4) return false;
    const width = fn.FPDFBitmap_GetWidth(bitmap);
    const height = fn.FPDFBitmap_GetHeight(bitmap);
    const stride = fn.FPDFBitmap_GetStride(bitmap);
    const start = fn.FPDFBitmap_GetBuffer(bitmap);
    const heap = pdf.wasm.HEAPU8;
    for (let y = 0; y < height; y++) {
      for (let at = start + y * stride + 3, end = at + width * 4; at < end; at += 4) {
        if (heap[at] < 255) return true;
      }
    }
    return false;
  } finally {
    fn.FPDFBitmap_Destroy(bitmap);
  }
}

/**
 * The image's own pixels, without its mask, as RGBA.
 *
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} obj
 * @returns {{ rgba: Uint8Array, width: number, height: number } | null}
 */
function readBitmap(pdf, obj) {
  const { fn } = pdf;
  const bitmap = fn.FPDFImageObj_GetBitmap(obj);
  if (!bitmap) return null;
  try {
    const format = fn.FPDFBitmap_GetFormat(bitmap);
    const width = fn.FPDFBitmap_GetWidth(bitmap);
    const height = fn.FPDFBitmap_GetHeight(bitmap);
    const stride = fn.FPDFBitmap_GetStride(bitmap);
    const start = fn.FPDFBitmap_GetBuffer(bitmap);
    const heap = pdf.wasm.HEAPU8;
    // 1 grey, 2 BGR, 3 BGRx, 4 BGRA
    const step = { 1: 1, 2: 3, 3: 4, 4: 4 }[/** @type {1 | 2 | 3 | 4} */ (format)];
    if (!step) return null;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      let at = start + y * stride;
      for (let x = 0; x < width; x++, at += step) {
        const o = (y * width + x) * 4;
        if (step === 1) {
          rgba[o] = rgba[o + 1] = rgba[o + 2] = heap[at];
        } else {
          rgba[o] = heap[at + 2];
          rgba[o + 1] = heap[at + 1];
          rgba[o + 2] = heap[at];
        }
        rgba[o + 3] = 255;
      }
    }
    return { rgba, width, height };
  } finally {
    fn.FPDFBitmap_Destroy(bitmap);
  }
}

/**
 * Scale down by averaging each block of source pixels.
 *
 * @param {Uint8Array} src  RGBA
 * @param {number} sw
 * @param {number} sh
 * @param {number} dw
 * @param {number} dh
 */
export function downscale(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0, i = (yy * sw + x0) * 4; xx < x1; xx++, i += 4) {
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * dw + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return out;
}
