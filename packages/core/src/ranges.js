import { fail } from './errors.js';
import { pageNumber } from './options.js';

/**
 * Turn a page list written by a person into page numbers.
 *
 * "1-3,5" is 1, 2, 3, 5. "8-" runs to the end, "-2" from the start, "3-1" backwards.
 * "last" is the last page, and "all", "odd" and "even" do what they say. Repeats are kept,
 * because they mean something when reordering.
 *
 * @param {string} spec
 * @param {number} pageCount
 * @returns {number[]}
 */
export function pageRanges(spec, pageCount) {
  if (typeof spec !== 'string') fail('INVALID_OPTION', 'A page list must be a string like "1-3,5".');
  const words = { all: '1-last', odd: 'odd', even: 'even' };
  const trimmed = spec.trim().toLowerCase();
  if (trimmed === 'odd' || trimmed === 'even') {
    const start = trimmed === 'odd' ? 1 : 2;
    const out = [];
    for (let n = start; n <= pageCount; n += 2) out.push(n);
    return out;
  }
  const items = (words[/** @type {keyof words} */ (trimmed)] ?? trimmed).split(',');

  /** @type {number[]} */
  const pages = [];
  for (const raw of items) {
    const item = raw.trim();
    const match = /^(\d+|last)?\s*(-)?\s*(\d+|last)?$/.exec(item);
    if (!item || !match || (!match[1] && !match[3])) fail('INVALID_OPTION', `"${spec}" is not a page list. Try something like "1-3,5,8-".`);
    const [, from, dash, to] = match;
    const first = from ? value(from, pageCount) : 1;
    const last = dash ? (to ? value(to, pageCount) : pageCount) : first;
    if (!dash && to) fail('INVALID_OPTION', `"${spec}" is not a page list.`);
    pageNumber(first, 'page', pageCount);
    pageNumber(last, 'page', pageCount);
    const step = last >= first ? 1 : -1;
    for (let n = first; n !== last + step; n += step) pages.push(n);
  }
  return pages;
}

/**
 * @param {string} token
 * @param {number} pageCount
 */
function value(token, pageCount) {
  return token === 'last' ? pageCount : Number(token);
}
