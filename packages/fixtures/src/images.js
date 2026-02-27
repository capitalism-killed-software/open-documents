// Small images built in code, for testing images-to-PDF. Node only.
import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';

/** @typedef {(x: number, y: number) => [number, number, number, number]} Fill */

/**
 * The default fill is left half red, right half blue, so it is easy to tell which way up an
 * image ended.
 *
 * @param {number} width
 * @param {number} height
 * @param {Fill} [fill]
 */
function pixels(width, height, fill) {
  /** @type {Fill} */
  const paint = fill ?? ((x) => (x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba.set(paint(x, y), (y * width + x) * 4);
  }
  return rgba;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param {{ width?: number, height?: number, fill?: Fill }} [options]
 * @returns {Uint8Array}
 */
export function pngImage({ width = 40, height = 20, fill } = {}) {
  const rgba = pixels(width, height, fill);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, y * (width * 4 + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/**
 * A baseline JPEG, optionally with an EXIF orientation tag like the ones phone cameras write.
 *
 * @param {{ width?: number, height?: number, fill?: Fill, orientation?: number, quality?: number }} [options]
 *   orientation: 1 as stored, 3 turned 180, 6 turned 90 clockwise, 8 turned 90 anticlockwise
 * @returns {Uint8Array}
 */
export function jpegImage({ width = 40, height = 20, fill, orientation, quality = 90 } = {}) {
  const encoded = jpeg.encode({ data: pixels(width, height, fill), width, height }, quality).data;
  if (orientation === undefined) return new Uint8Array(encoded);
  const exif = Buffer.from([
    0xff, 0xe1, 0x00, 0x22, // APP1, 34 bytes
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  return new Uint8Array(Buffer.concat([encoded.subarray(0, 2), exif, encoded.subarray(2)]));
}
