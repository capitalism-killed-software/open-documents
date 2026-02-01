// Shared plumbing for operations that change a document and hand back new bytes.
import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { pageRanges } from './ranges.js';
import { pageNumber } from './options.js';
import { fail } from './errors.js';

/**
 * Which pages an operation applies to: page numbers, or a page list like "1-3,5,last".
 * Leaving it out means every page.
 *
 * @typedef {number[] | string} PageSelection
 */

/**
 * @param {PageSelection | undefined} pages
 * @param {number} pageCount
 * @returns {number[]} 1-based
 */
export function selectPages(pages, pageCount) {
  if (pages === undefined) return Array.from({ length: pageCount }, (_, i) => i + 1);
  if (typeof pages === 'string') return pageRanges(pages, pageCount);
  if (!Array.isArray(pages)) fail('INVALID_OPTION', 'pages must be an array of page numbers or a page list like "1-3,5".');
  return pages.map((n) => pageNumber(n, 'pages', pageCount));
}

/**
 * Open a document, change it with a synchronous function, save it. The saved file keeps
 * whatever encryption it had.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ password?: string }} options
 * @param {(pdf: import('./engine/pdfium.js').Engine, doc: number) => void} change
 * @returns {Promise<Uint8Array>}
 */
export async function modify(input, options, change) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) => {
    change(pdf, doc);
    return pdf.save(doc);
  });
}

/**
 * Open a document and build something new from it.
 *
 * @template T
 * @param {import('./input.js').DocumentInput} input
 * @param {{ password?: string }} options
 * @param {(pdf: import('./engine/pdfium.js').Engine, doc: number) => T} use
 * @returns {Promise<T>}
 */
export async function fromDocument(input, options, use) {
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  return pdf.withDocument(bytes, options, (doc) => use(pdf, doc));
}

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];

/**
 * Copy the document information (title, author and so on) from one document to another.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} from
 * @param {number} to
 */
export function copyMetadata(pdf, from, to) {
  for (const key of INFO_KEYS) {
    const value = pdf.readUtf16((ptr, length) => pdf.fn.FPDF_GetMetaText(from, key, ptr, length));
    if (value) setMetaText(pdf, to, key, value);
  }
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {string} key
 * @param {string} value
 */
export function setMetaText(pdf, doc, key, value) {
  const size = (value.length + 1) * 2;
  const ptr = pdf.malloc(size);
  try {
    pdf.wasm.stringToUTF16(value, ptr, size);
    if (!pdf.fn.EPDF_SetMetaText(doc, key, ptr)) fail('ENGINE_ERROR', `Could not set ${key}.`);
  } finally {
    pdf.free(ptr);
  }
}

/**
 * Build a new document from pages of an open one, with the source's metadata.
 *
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} src
 * @param {number[]} pages  1-based, in order, repeats allowed
 * @returns {Uint8Array}
 */
export function pagesToNewDocument(pdf, src, pages) {
  return pdf.withNewDocument((dest) => {
    pdf.importPages(dest, src, pages.map((n) => n - 1), 0);
    copyMetadata(pdf, src, dest);
    pdf.fn.FPDF_CopyViewerPreferences(dest, src);
    return pdf.save(dest);
  });
}
