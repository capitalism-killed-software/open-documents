// What is this file? Decided from its bytes, with the file name only as a tie-breaker, so a
// renamed file goes to the right converter. Zip-based formats are checked before anyone
// unpacks them.
import { OpenDocumentsError } from '@open-documents/core';

/**
 * @typedef {'pdf' | 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'odg' | 'doc' | 'xls' | 'ppt'
 *   | 'rtf' | 'csv' | 'text' | 'html' | 'markdown' | 'eml' | 'msg'
 *   | 'jpeg' | 'png' | 'gif' | 'tiff' | 'webp' | 'bmp' | 'epub' | 'unknown'} Kind
 */

/**
 * @typedef {'pdf' | 'office' | 'web' | 'email' | 'image' | 'other'} Family
 */

/** @type {Record<Kind, Family>} */
const FAMILY = {
  pdf: 'pdf',
  docx: 'office', xlsx: 'office', pptx: 'office', odt: 'office', ods: 'office', odp: 'office', odg: 'office',
  doc: 'office', xls: 'office', ppt: 'office', rtf: 'office', csv: 'office', text: 'office',
  html: 'web', markdown: 'web',
  eml: 'email', msg: 'email',
  jpeg: 'image', png: 'image', gif: 'image', tiff: 'image', webp: 'image', bmp: 'image',
  epub: 'other', unknown: 'other',
};

const ODF = {
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.graphics': 'odg',
  'application/epub+zip': 'epub',
};

/**
 * @typedef {object} ZipLimits
 * @property {number} [maxEntries]  default 10 000
 * @property {number} [maxSize]     total unpacked bytes; default 512 MB
 * @property {number} [maxRatio]    unpacked to packed, for anything over 10 MB; default 100
 */

/**
 * @param {Uint8Array} bytes
 * @param {{ filename?: string, zip?: ZipLimits }} [options]
 * @returns {{ kind: Kind, family: Family }}
 */
export function sniff(bytes, options = {}) {
  const kind = detect(bytes, extension(options.filename), options.zip);
  return { kind, family: FAMILY[kind] };
}

/**
 * @param {Uint8Array} b
 * @param {string} ext
 * @param {ZipLimits | undefined} limits
 * @returns {Kind}
 */
function detect(b, ext, limits) {
  const starts = (/** @type {number[]} */ sig, at = 0) => sig.every((v, i) => b[at + i] === v);
  if (findPdfHeader(b)) return 'pdf';
  if (starts([0x50, 0x4b, 0x03, 0x04]) || starts([0x50, 0x4b, 0x05, 0x06])) return zipKind(b, limits);
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return oleKind(b, ext);
  if (starts([0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf'; // {\rtf
  if (starts([0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (starts([0x42, 0x4d]) && ext === 'bmp') return 'bmp';
  return textKind(b, ext);
}

/** @param {Uint8Array} b */
function findPdfHeader(b) {
  const head = latin1(b.subarray(0, 1024));
  return head.includes('%PDF-');
}

/**
 * @param {Uint8Array} b
 * @param {ZipLimits | undefined} limits
 * @returns {Kind}
 */
function zipKind(b, limits) {
  const entries = checkZip(b, limits);
  const names = new Set(entries.map((e) => e.name));
  const mimetype = entries.find((e) => e.name === 'mimetype');
  if (mimetype && mimetype.method === 0) {
    const value = latin1(b.subarray(mimetype.dataStart, mimetype.dataStart + mimetype.compressedSize)).trim();
    const kind = ODF[/** @type {keyof ODF} */ (value)];
    if (kind) return /** @type {Kind} */ (kind);
  }
  if (names.has('[Content_Types].xml')) {
    const has = (/** @type {string} */ prefix) => entries.some((e) => e.name.startsWith(prefix));
    if (has('word/')) return 'docx';
    if (has('xl/')) return 'xlsx';
    if (has('ppt/')) return 'pptx';
  }
  return 'unknown';
}

/**
 * Legacy Office and Outlook files share one container format. The stream names inside tell
 * them apart; they are stored as UTF-16.
 *
 * @param {Uint8Array} b
 * @param {string} ext
 * @returns {Kind}
 */
function oleKind(b, ext) {
  const text = latin1(b).replace(/\0/g, '');
  if (text.includes('__substg1.0_')) return 'msg';
  if (text.includes('WordDocument')) return 'doc';
  if (text.includes('PowerPoint Document')) return 'ppt';
  if (text.includes('Workbook') || text.includes('Book')) return 'xls';
  return /** @type {Kind} */ ((['doc', 'xls', 'ppt', 'msg'].includes(ext) ? ext : 'unknown'));
}

/**
 * @param {Uint8Array} b
 * @param {string} ext
 * @returns {Kind}
 */
function textKind(b, ext) {
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 4096)).replace(/^\uFEFF/, '');
  if (head.includes('\0')) return 'unknown';
  const start = head.trimStart().slice(0, 200).toLowerCase();
  if (start.startsWith('<!doctype html') || start.startsWith('<html')) return 'html';
  if (/^(?:(?:received|return-path|from|to|subject|date|message-id|mime-version|content-type):.*\r?\n){3,}/im.test(head.slice(0, 2000)) && /^from:/im.test(head)) {
    return 'eml';
  }
  /** @type {Record<string, Kind>} */
  const byExt = { md: 'markdown', markdown: 'markdown', csv: 'csv', txt: 'text', html: 'html', htm: 'html', eml: 'eml' };
  return byExt[ext] ?? 'text';
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} size
 * @property {number} dataStart  where the entry's data begins, when the local header could be read
 */

/**
 * Read a zip's directory and refuse it if it would unpack to something dangerous. This reads
 * only the directory; nothing is decompressed.
 *
 * @param {Uint8Array} b
 * @param {ZipLimits} [limits]
 * @returns {ZipEntry[]}
 */
export function checkZip(b, limits = {}) {
  const maxEntries = limits.maxEntries ?? 10_000;
  const maxSize = limits.maxSize ?? 512 * 1024 * 1024;
  const maxRatio = limits.maxRatio ?? 100;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const bad = (/** @type {string} */ why) => new OpenDocumentsError('INVALID_INPUT', `This archive cannot be opened safely: ${why}.`);

  // end of central directory: in the last 64 KB, after an optional comment
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad('no zip directory');
  let count = view.getUint16(eocd + 10, true);
  let dirSize = view.getUint32(eocd + 12, true);
  let dirStart = view.getUint32(eocd + 16, true);
  if (count === 0xffff || dirStart === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) throw bad('a damaged zip64 directory');
    const z64 = Number(view.getBigUint64(locator + 8, true));
    if (z64 + 56 > b.length || view.getUint32(z64, true) !== 0x06064b50) throw bad('a damaged zip64 directory');
    count = Number(view.getBigUint64(z64 + 32, true));
    dirSize = Number(view.getBigUint64(z64 + 40, true));
    dirStart = Number(view.getBigUint64(z64 + 48, true));
  }
  if (count > maxEntries) throw bad(`${count} entries, more than ${maxEntries}`);
  if (dirStart + dirSize > b.length) throw bad('a directory outside the file');

  /** @type {ZipEntry[]} */
  const entries = [];
  let total = 0;
  let packed = 0;
  let at = dirStart;
  for (let i = 0; i < count; i++) {
    if (at + 46 > b.length || view.getUint32(at, true) !== 0x02014b50) throw bad('a damaged directory');
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let localHeader = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(b.subarray(at + 46, at + 46 + nameLength));
    // zip64 sizes live in an extra field
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let p = extra + 4;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(p, true)); p += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(view.getBigUint64(p, true)); p += 8; }
        if (localHeader === 0xffffffff) localHeader = Number(view.getBigUint64(p, true));
      }
      extra += 4 + length;
    }
    let dataStart = -1;
    if (localHeader + 30 <= b.length && view.getUint32(localHeader, true) === 0x04034b50) {
      dataStart = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
    }
    if (name.includes('..') && /(^|[\\/])\.\.([\\/]|$)/.test(name)) throw bad(`an entry that climbs out of the archive (${name})`);
    total += size;
    packed += compressedSize;
    if (total > maxSize) throw bad(`it unpacks to more than ${Math.round(maxSize / 1048576)} MB`);
    entries.push({ name, method, compressedSize, size, dataStart });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (total > 10 * 1024 * 1024 && total / Math.max(1, packed) > maxRatio) {
    throw bad(`it unpacks to ${Math.round(total / Math.max(1, packed))} times its size, which is how zip bombs work`);
  }
  return entries;
}

/** @param {string | undefined} filename */
function extension(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(filename ?? '');
  return match ? match[1].toLowerCase() : '';
}

/** @param {Uint8Array} b */
function latin1(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 65_536) s += String.fromCharCode(...b.subarray(i, i + 65_536));
  return s;
}
