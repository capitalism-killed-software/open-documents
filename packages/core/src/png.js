// A small PNG encoder for 8-bit RGBA pixels. Enough for page renders; no decoder needed here.
import { zlibSync } from 'fflate';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Each row gets the "Sub" filter, which suits rendered pages: long runs of the same colour
 * become zeros and compress well.
 *
 * @param {Uint8Array} rgba  width * height * 4 bytes
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function encodePng(rgba, width, height) {
  const rowBytes = width * 4;
  const filtered = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const dst = y * (rowBytes + 1);
    filtered[dst] = 1; // Sub
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= 4 ? rgba[src + x - 4] : 0;
      filtered[dst + 1 + x] = (rgba[src + x] - left) & 0xff;
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // compression, filter and interlace methods stay 0

  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(filtered, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
