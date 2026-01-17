import { fail } from './errors.js';

/**
 * Anything we accept as a document: raw bytes, an ArrayBuffer, a Node Buffer (which is a
 * Uint8Array) or a Blob/File from the browser.
 *
 * @typedef {Uint8Array | ArrayBuffer | Blob} DocumentInput
 */

const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const HEADER_SEARCH = 1024; // the header may follow some junk bytes

/**
 * @param {DocumentInput} input
 * @returns {Promise<Uint8Array>}
 */
export async function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  return fail('INVALID_INPUT', 'Expected a Uint8Array, ArrayBuffer or Blob.');
}

/**
 * Bytes of a PDF file, checked for the `%PDF-` header.
 *
 * @param {DocumentInput} input
 * @returns {Promise<Uint8Array>}
 */
export async function toPdfBytes(input) {
  const bytes = await toBytes(input);
  if (findHeader(bytes) < 0) fail('INVALID_INPUT', 'This is not a PDF file: no %PDF- header.');
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number} offset of the header, or -1
 */
export function findHeader(bytes) {
  const end = Math.min(bytes.length, HEADER_SEARCH) - HEADER.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < HEADER.length; j++) {
      if (bytes[i + j] !== HEADER[j]) continue outer;
    }
    return i;
  }
  return -1;
}
