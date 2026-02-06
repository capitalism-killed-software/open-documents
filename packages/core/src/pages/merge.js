import { engine } from '../engine/pdfium.js';
import { toPdfBytes } from '../input.js';
import { selectPages, copyMetadata } from '../modify.js';
import { fail } from '../errors.js';

/**
 * One document to merge: just its bytes, or its bytes with the pages to take and a password.
 *
 * @typedef {import('../input.js').DocumentInput | {
 *   input: import('../input.js').DocumentInput,
 *   pages?: import('../modify.js').PageSelection,
 *   password?: string,
 * }} MergeItem
 */

/**
 * Join documents into one, in the order given. The result takes its metadata from the first
 * document. Bookmarks and form fields are not carried over, and the result is not encrypted.
 *
 * @param {MergeItem[]} inputs
 * @returns {Promise<Uint8Array>}
 */
export async function merge(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) fail('INVALID_OPTION', 'merge needs a list of documents.');
  const items = await Promise.all(
    inputs.map(async (item) => {
      const spec = isPlainItem(item) ? item : { input: item };
      return { bytes: await toPdfBytes(spec.input), password: spec.password, pages: spec.pages };
    }),
  );
  const pdf = await engine();
  return pdf.withDocuments(items, (docs) =>
    pdf.withNewDocument((dest) => {
      docs.forEach((src, i) => {
        const pages = selectPages(items[i].pages, pdf.fn.FPDF_GetPageCount(src));
        pdf.importPages(dest, src, pages.map((n) => n - 1), pdf.fn.FPDF_GetPageCount(dest));
      });
      copyMetadata(pdf, docs[0], dest);
      pdf.fn.FPDF_CopyViewerPreferences(dest, docs[0]);
      return pdf.save(dest);
    }),
  );
}

/**
 * @param {MergeItem} item
 * @returns {item is { input: import('../input.js').DocumentInput, pages?: import('../modify.js').PageSelection, password?: string }}
 */
function isPlainItem(item) {
  return typeof item === 'object' && item !== null && 'input' in item;
}
