import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';

/**
 * @typedef {object} PageInfo
 * @property {number} number    1-based
 * @property {number} width     points (1/72 inch), as a viewer shows it, after rotation
 * @property {number} height    points, as a viewer shows it, after rotation
 * @property {0 | 90 | 180 | 270} rotation  clockwise, as shown by a viewer
 */

/**
 * @typedef {object} DocumentInfo
 * @property {string | null} version   e.g. "1.7"
 * @property {number} pageCount
 * @property {PageInfo[]} pages
 * @property {boolean} encrypted
 * @property {number} permissions  raw /P bits; -1 when there are no restrictions
 * @property {'none' | 'acroform' | 'xfa'} forms
 * @property {boolean} tagged
 * @property {number} signatures
 * @property {number} attachments
 * @property {number} bookmarks   top-level outline entries
 * @property {Metadata} metadata
 */

/**
 * @typedef {object} Metadata
 * @property {string} title
 * @property {string} author
 * @property {string} subject
 * @property {string} keywords
 * @property {string} creator
 * @property {string} producer
 * @property {string} creationDate  raw PDF date string, e.g. "D:20200101000000Z"
 * @property {string} modDate
 */

const META_KEYS = /** @type {const} */ ({
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  creationDate: 'CreationDate',
  modDate: 'ModDate',
});

const FORM_TYPES = /** @type {const} */ (['none', 'acroform', 'xfa', 'xfa']);

/**
 * Describe a PDF without changing it: pages, sizes, rotation, metadata, security, forms.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ password?: string }} [options]
 * @returns {Promise<DocumentInfo>}
 */
export async function inspect(input, options = {}) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;

  return pdf.withDocument(bytes, options, (doc) => {
    const pageCount = fn.FPDF_GetPageCount(doc);
    const pages = [];
    for (let i = 0; i < pageCount; i++) {
      const [width, height] = pageSize(pdf, doc, i);
      pages.push({
        number: i + 1,
        width,
        height,
        rotation: /** @type {PageInfo['rotation']} */ (((fn.EPDF_GetPageRotationByIndex(doc, i) % 4) + 4) % 4 * 90),
      });
    }

    /** @type {Record<string, string>} */
    const metadata = {};
    for (const [name, key] of Object.entries(META_KEYS)) {
      metadata[name] = pdf.readUtf16((ptr, length) => fn.FPDF_GetMetaText(doc, key, ptr, length));
    }

    return {
      version: fileVersion(pdf, doc),
      pageCount,
      pages,
      encrypted: fn.EPDF_IsEncrypted(doc),
      permissions: fn.FPDF_GetDocPermissions(doc) | 0,
      forms: FORM_TYPES[fn.FPDF_GetFormType(doc)] ?? 'none',
      tagged: fn.FPDFCatalog_IsTagged(doc),
      signatures: Math.max(0, fn.FPDF_GetSignatureCount(doc)),
      attachments: Math.max(0, fn.FPDFDoc_GetAttachmentCount(doc)),
      bookmarks: countSiblings(pdf, doc, fn.FPDFBookmark_GetFirstChild(doc, 0)),
      metadata: /** @type {Metadata} */ (metadata),
    };
  });
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} index
 * @returns {[number, number]}
 */
function pageSize(pdf, doc, index) {
  const [width, height] = pdf.readFloats(2, (ptr) => pdf.fn.FPDF_GetPageSizeByIndexF(doc, index, ptr));
  return [round(width), round(height)];
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 */
function fileVersion(pdf, doc) {
  const ptr = pdf.malloc(4);
  try {
    if (!pdf.fn.FPDF_GetFileVersion(doc, ptr)) return null;
    const v = pdf.wasm.getValue(ptr, 'i32');
    return `${Math.floor(v / 10)}.${v % 10}`;
  } finally {
    pdf.free(ptr);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {number} first
 */
function countSiblings(pdf, doc, first) {
  let count = 0;
  for (let item = first; item && count < 100_000; item = pdf.fn.FPDFBookmark_GetNextSibling(doc, item)) count++;
  return count;
}

/** @param {number} n  to 2 decimals, enough for points */
function round(n) {
  return Math.round(n * 100) / 100;
}
