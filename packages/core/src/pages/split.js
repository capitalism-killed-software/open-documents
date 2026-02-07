import { fromDocument, selectPages, pagesToNewDocument } from '../modify.js';
import { fail } from '../errors.js';
import { numberIn } from '../options.js';

/**
 * @typedef {object} SplitOptions
 * @property {number} [every]  pages per file; 1 puts every page in its own file (the default)
 * @property {import('../modify.js').PageSelection[]} [ranges]  one file per entry, e.g. ["1-3", "4-last"]
 * @property {number[]} [at]   start a new file at each of these pages, e.g. [4, 9]
 * @property {string} [password]
 */

/**
 * Cut a document into several. Give at most one of `every`, `ranges` or `at`.
 * Each part keeps the metadata; none is encrypted.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {SplitOptions} [options]
 * @returns {Promise<Uint8Array[]>}
 */
export async function split(input, options = {}) {
  const given = ['every', 'ranges', 'at'].filter((k) => options[/** @type {keyof SplitOptions} */ (k)] !== undefined);
  if (given.length > 1) fail('INVALID_OPTION', `Give only one of every, ranges or at, not ${given.join(' and ')}.`);
  return fromDocument(input, options, (pdf, doc) => {
    const count = pdf.fn.FPDF_GetPageCount(doc);
    return groups(options, count).map((pages) => pagesToNewDocument(pdf, doc, pages));
  });
}

/**
 * @param {SplitOptions} options
 * @param {number} count
 * @returns {number[][]}
 */
function groups(options, count) {
  if (options.ranges !== undefined) {
    if (!Array.isArray(options.ranges) || options.ranges.length === 0) fail('INVALID_OPTION', 'ranges must be a list of page lists.');
    return options.ranges.map((r) => selectPages(r, count));
  }
  if (options.at !== undefined) {
    if (!Array.isArray(options.at)) fail('INVALID_OPTION', 'at must be a list of page numbers.');
    const starts = [...new Set([1, ...selectPages(options.at, count)])].sort((a, b) => a - b);
    return starts.map((start, i) => {
      const end = (starts[i + 1] ?? count + 1) - 1;
      return Array.from({ length: end - start + 1 }, (_, k) => start + k);
    });
  }
  const every = Math.floor(numberIn(options.every ?? 1, 'every', 1, Number.MAX_SAFE_INTEGER));
  const out = [];
  for (let start = 1; start <= count; start += every) {
    out.push(Array.from({ length: Math.min(every, count - start + 1) }, (_, k) => start + k));
  }
  return out;
}
