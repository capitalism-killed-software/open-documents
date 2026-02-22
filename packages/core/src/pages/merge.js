import { engine } from '../engine/pdfium.js';
import { toPdfBytes } from '../input.js';
import { selectPages, copyMetadata } from '../modify.js';
import { fail } from '../errors.js';
import { writeBookmarks } from '../edit/bookmarks.js';

/**
 * One document to merge: just its bytes, or its bytes with the pages to take and a password.
 *
 * @typedef {import('../input.js').DocumentInput | {
 *   input: import('../input.js').DocumentInput,
 *   pages?: import('../modify.js').PageSelection,
 *   password?: string,
 *   title?: string,
 * }} MergeItem
 */

/**
 * Join documents into one, in the order given. The result takes its metadata from the first
 * document. Bookmarks and form fields are not carried over, and the result is not encrypted.
 * With `bookmarks: true`, the result gets one bookmark per document, titled by its `title`
 * or "Document 1", "Document 2" and so on.
 *
 * @param {MergeItem[]} inputs
 * @param {{ bookmarks?: boolean }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function merge(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) fail('INVALID_OPTION', 'merge needs a list of documents.');
  const items = await Promise.all(
    inputs.map(async (item) => {
      const spec = isPlainItem(item) ? item : { input: item };
      return { bytes: await toPdfBytes(spec.input), password: spec.password, pages: spec.pages, title: spec.title };
    }),
  );
  const pdf = await engine();
  return pdf.withDocuments(items, (docs) =>
    pdf.withNewDocument((dest) => {
      /** @type {{ title: string, page: number }[]} */
      const starts = [];
      docs.forEach((src, i) => {
        const pages = selectPages(items[i].pages, pdf.fn.FPDF_GetPageCount(src));
        const at = pdf.fn.FPDF_GetPageCount(dest);
        pdf.importPages(dest, src, pages.map((n) => n - 1), at);
        if (pages.length) starts.push({ title: items[i].title ?? `Document ${i + 1}`, page: at + 1 });
      });
      copyMetadata(pdf, docs[0], dest);
      if (options.bookmarks) writeBookmarks(pdf, dest, starts);
      pdf.fn.FPDF_CopyViewerPreferences(dest, docs[0]);
      return pdf.save(dest);
    }),
  );
}

/**
 * @param {MergeItem} item
 * @returns {item is { input: import('../input.js').DocumentInput, pages?: import('../modify.js').PageSelection, password?: string, title?: string }}
 */
function isPlainItem(item) {
  // a bare document is bytes or a Blob; anything else with `input` is the longer form
  return typeof item === 'object' && item !== null && 'input' in item;
}
