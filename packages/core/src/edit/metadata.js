import { modify, setMetaText } from '../modify.js';
import { fail } from '../errors.js';

const KEYS = /** @type {const} */ ({
  title: 'Title',
  author: 'Author',
  subject: 'Subject',
  keywords: 'Keywords',
  creator: 'Creator',
  producer: 'Producer',
  creationDate: 'CreationDate',
  modDate: 'ModDate',
});

/**
 * @typedef {object} MetadataChanges
 * @property {string | null} [title]
 * @property {string | null} [author]
 * @property {string | null} [subject]
 * @property {string | string[] | null} [keywords]  a list is joined with ", "
 * @property {string | null} [creator]
 * @property {string | null} [producer]
 * @property {Date | string | null} [creationDate]  a Date, or a PDF date string like "D:20240102030405Z"
 * @property {Date | string | null} [modDate]
 */

/**
 * Change the document information: title, author and so on. Keys left out are kept; `null` or
 * "" clears one. Read it back with inspect(). XMP metadata, if the file has any, is not touched.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {MetadataChanges & { password?: string }} changes
 * @returns {Promise<Uint8Array>}
 */
export async function setMetadata(input, changes) {
  if (!changes || typeof changes !== 'object') fail('INVALID_OPTION', 'setMetadata needs the fields to change, like { title }.');
  /** @type {[string, string][]} */
  const updates = [];
  for (const [name, value] of Object.entries(changes)) {
    if (name === 'password') continue;
    const key = KEYS[/** @type {keyof KEYS} */ (name)];
    if (!key) fail('INVALID_OPTION', `Unknown metadata field "${name}". Use ${Object.keys(KEYS).join(', ')}.`);
    updates.push([key, toText(name, value)]);
  }
  return modify(input, changes, (pdf, doc) => {
    for (const [key, value] of updates) setMetaText(pdf, doc, key, value);
  });
}

/**
 * @param {string} name
 * @param {unknown} value
 * @returns {string}
 */
function toText(name, value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail('INVALID_OPTION', `${name} is not a valid date.`);
    return pdfDate(value);
  }
  if (Array.isArray(value) && name === 'keywords') return value.join(', ');
  if (typeof value !== 'string') fail('INVALID_OPTION', `${name} must be a string${name.endsWith('Date') ? ' or a Date' : ''}.`);
  return value;
}

/**
 * @param {Date} date
 * @returns {string} e.g. "D:20240102030405Z"
 */
export function pdfDate(date) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}
