import { modify, fromDocument } from '../modify.js';
import { fail } from '../errors.js';

/**
 * An entry in the outline (the bookmarks panel of a viewer).
 *
 * @typedef {object} Bookmark
 * @property {string} title
 * @property {number | null} [page]  1-based page it opens, or null for a heading that goes nowhere
 * @property {Bookmark[]} [children]
 */

const MAX_DEPTH = 64;
const MAX_ENTRIES = 100_000;
const PDFACTION_GOTO = 1;

/**
 * Read the outline as a tree.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {{ password?: string }} [options]
 * @returns {Promise<Required<Bookmark>[]>}
 */
export async function getBookmarks(input, options = {}) {
  return fromDocument(input, options, (pdf, doc) => {
    const { fn } = pdf;
    const seen = new Set();
    /**
     * @param {number} first
     * @param {number} depth
     * @returns {Required<Bookmark>[]}
     */
    const walk = (first, depth) => {
      const out = [];
      for (let item = first; item && depth < MAX_DEPTH && seen.size < MAX_ENTRIES; item = fn.FPDFBookmark_GetNextSibling(doc, item)) {
        if (seen.has(item)) break; // a loop in a damaged outline
        seen.add(item);
        let dest = fn.FPDFBookmark_GetDest(doc, item);
        if (!dest) {
          const action = fn.FPDFBookmark_GetAction(item);
          if (action && fn.FPDFAction_GetType(action) === PDFACTION_GOTO) dest = fn.FPDFAction_GetDest(doc, action);
        }
        const index = dest ? fn.FPDFDest_GetDestPageIndex(doc, dest) : -1;
        out.push({
          title: pdf.readUtf16((ptr, length) => fn.FPDFBookmark_GetTitle(item, ptr, length)),
          page: index >= 0 ? index + 1 : null,
          children: walk(fn.FPDFBookmark_GetFirstChild(doc, item), depth + 1),
        });
      }
      return out;
    };
    return walk(fn.FPDFBookmark_GetFirstChild(doc, 0), 0);
  });
}

/**
 * Replace the outline. Pass [] to remove it.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Bookmark[]} bookmarks
 * @param {{ password?: string }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function setBookmarks(input, bookmarks, options = {}) {
  if (!Array.isArray(bookmarks)) fail('INVALID_OPTION', 'bookmarks must be a list like [{ title, page }].');
  return modify(input, options, (pdf, doc) => writeBookmarks(pdf, doc, bookmarks));
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} doc
 * @param {Bookmark[]} bookmarks
 */
export function writeBookmarks(pdf, doc, bookmarks) {
  const { fn } = pdf;
  const pageCount = fn.FPDF_GetPageCount(doc);
  check(bookmarks, pageCount, 0);
  if (!fn.EPDFBookmark_Clear(doc)) fail('ENGINE_ERROR', 'Could not clear the old bookmarks.');
  /**
   * @param {number} parent
   * @param {Bookmark[]} items
   */
  const add = (parent, items) => {
    for (const b of items) {
      const size = (b.title.length + 1) * 2;
      const ptr = pdf.malloc(size);
      let item = 0;
      try {
        pdf.wasm.stringToUTF16(b.title, ptr, size);
        item = fn.EPDFBookmark_AppendChild(doc, parent, ptr);
      } finally {
        pdf.free(ptr);
      }
      if (!item) fail('ENGINE_ERROR', `Could not add the bookmark "${b.title}".`);
      if (b.page) {
        const dest = pdf.withPage(doc, b.page - 1, (page) => {
          const [left, , , top] = pdf.visibleBox(page);
          return fn.EPDFDest_CreateXYZ(page, true, left, true, top, false, 0);
        });
        if (!dest || !fn.EPDFBookmark_SetDest(doc, item, dest)) fail('ENGINE_ERROR', `Could not point "${b.title}" at page ${b.page}.`);
      }
      if (b.children?.length) add(item, b.children);
    }
  };
  add(0, bookmarks);
}

/**
 * @param {Bookmark[]} items
 * @param {number} pageCount
 * @param {number} depth
 */
function check(items, pageCount, depth) {
  if (depth > MAX_DEPTH) fail('INVALID_OPTION', `Bookmarks can nest at most ${MAX_DEPTH} deep.`);
  for (const b of items) {
    if (!b || typeof b.title !== 'string') fail('INVALID_OPTION', 'Every bookmark needs a title.');
    if (b.page !== undefined && b.page !== null && (!Number.isInteger(b.page) || b.page < 1 || b.page > pageCount)) {
      fail('PAGE_NOT_FOUND', `The bookmark "${b.title}" points at page ${b.page}, but the document has ${pageCount}.`);
    }
    if (b.children !== undefined) {
      if (!Array.isArray(b.children)) fail('INVALID_OPTION', `The children of "${b.title}" must be a list.`);
      check(b.children, pageCount, depth + 1);
    }
  }
}
