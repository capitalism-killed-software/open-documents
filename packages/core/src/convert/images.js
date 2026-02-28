import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import { toBytes } from '../input.js';
import { fail, OpenDocumentsError } from '../errors.js';
import { numberIn } from '../options.js';

const PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89], legal: [612, 1008] };

/**
 * @typedef {object} ImagesToPdfOptions
 * @property {'fit' | 'letter' | 'a4' | 'legal' | [number, number]} [pageSize]
 *   "fit" makes each page the size of its image at `dpi`; default "letter"
 * @property {number} [margin]   points around the image on fixed-size pages; default 0
 * @property {number} [dpi]      for "fit"; default 72, one pixel per point
 * @property {'auto' | 'portrait' | 'landscape'} [orientation]
 *   on fixed-size pages, "auto" turns the page to match each image; default "auto"
 * @property {string} [title]
 */

/**
 * One page per image, in order. JPEG and PNG are supported; JPEG photos are turned the way
 * their camera's EXIF orientation says. Images are scaled to fit inside the margins, keeping
 * their shape, and centred.
 *
 * @param {(import('../input.js').DocumentInput)[]} images
 * @param {ImagesToPdfOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function imagesToPdf(images, options = {}) {
  if (!Array.isArray(images) || images.length === 0) fail('INVALID_OPTION', 'imagesToPdf needs a list of images.');
  const pageSize = options.pageSize ?? 'letter';
  const margin = numberIn(options.margin ?? 0, 'margin', 0, 1000);
  const dpi = numberIn(options.dpi ?? 72, 'dpi', 1, 2400);
  const orientation = options.orientation ?? 'auto';
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) fail('INVALID_OPTION', 'orientation must be auto, portrait or landscape.');
  if (!(pageSize === 'fit' || Array.isArray(pageSize) || pageSize in PAGE_SIZES)) {
    fail('INVALID_OPTION', 'pageSize must be "fit", "letter", "a4", "legal" or [width, height] in points.');
  }

  const doc = await PDFDocument.create();
  doc.setCreator('Open Documents');
  doc.setProducer('Open Documents');
  if (options.title) doc.setTitle(options.title);

  for (const [i, image] of images.entries()) {
    const bytes = await toBytes(image);
    const kind = sniff(bytes);
    if (!kind) fail('INVALID_INPUT', `Image ${i + 1} is not a JPEG or PNG.`);
    let embedded;
    try {
      embedded = kind === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    } catch (err) {
      throw new OpenDocumentsError('INVALID_INPUT', `Image ${i + 1} could not be read.`, { cause: err });
    }
    const turns = kind === 'jpeg' ? exifTurns(bytes) : 0;
    // the image as it should be seen, after the EXIF turn
    const shownW = turns % 2 ? embedded.height : embedded.width;
    const shownH = turns % 2 ? embedded.width : embedded.height;

    let pageW;
    let pageH;
    if (pageSize === 'fit') {
      pageW = (shownW * 72) / dpi;
      pageH = (shownH * 72) / dpi;
    } else {
      [pageW, pageH] = Array.isArray(pageSize) ? pageSize : PAGE_SIZES[pageSize];
      numberIn(pageW, 'pageSize width', 1, 14400);
      numberIn(pageH, 'pageSize height', 1, 14400);
      const landscape = orientation === 'landscape' || (orientation === 'auto' && shownW > shownH);
      if (landscape !== pageW > pageH) [pageW, pageH] = [pageH, pageW];
    }
    const page = doc.addPage([pageW, pageH]);
    const room = pageSize === 'fit' ? { w: pageW, h: pageH } : { w: pageW - 2 * margin, h: pageH - 2 * margin };
    if (room.w <= 0 || room.h <= 0) fail('INVALID_OPTION', 'The margin leaves no room for the image.');
    const scale = Math.min(room.w / shownW, room.h / shownH);
    const W = shownW * scale;
    const H = shownH * scale;
    const X = (pageW - W) / 2;
    const Y = (pageH - H) / 2;
    // drawImage turns around its bottom-left corner, so move that corner to keep the image in place
    const draw = [
      { x: X, y: Y, rotate: 0 },
      { x: X, y: Y + H, rotate: -90 },
      { x: X + W, y: Y + H, rotate: 180 },
      { x: X + W, y: Y, rotate: 90 },
    ][turns];
    page.drawImage(embedded, {
      x: draw.x,
      y: draw.y,
      width: turns % 2 ? H : W,
      height: turns % 2 ? W : H,
      rotate: degrees(draw.rotate),
    });
  }
  return doc.save();
}

/**
 * @param {Uint8Array} bytes
 * @returns {'jpeg' | 'png' | null}
 */
function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return null;
}

/**
 * Clockwise quarter turns needed to show a JPEG the right way up, from its EXIF orientation.
 * Mirrored orientations (2, 4, 5, 7) are treated as their unmirrored turn.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function exifTurns(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    if (marker === 0xda) break; // image data starts; no more headers
    if (marker === 0xe1 && length >= 16 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'Exif') {
      const tiff = offset + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (/** @type {number} */ at) => view.getUint16(at, little);
      const u32 = (/** @type {number} */ at) => view.getUint32(at, little);
      if (tiff + 8 > bytes.length) return 0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 0;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 0;
        if (u16(entry) === 0x0112) {
          return { 1: 0, 2: 0, 3: 2, 4: 2, 5: 1, 6: 1, 7: 3, 8: 3 }[u16(entry + 8)] ?? 0;
        }
      }
      return 0;
    }
    offset += 2 + length;
  }
  return 0;
}
