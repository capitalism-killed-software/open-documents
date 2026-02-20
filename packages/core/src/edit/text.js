import { stamp, resolveStyle, checkPlacement, checkLatin } from './stamp.js';
import { fail } from '../errors.js';

/**
 * @typedef {import('./stamp.js').TextStyle & {
 *   pages?: import('../modify.js').PageSelection,
 *   password?: string,
 * }} Common
 */

/**
 * Put text on pages: at a point (`at`, the top left of the text as shown) or at one of the
 * nine positions inside a margin.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Common & Omit<import('./stamp.js').Placement, 'text'> & { text: string }} options
 * @returns {Promise<Uint8Array>}
 */
export async function addText(input, options) {
  if (!options) fail('INVALID_OPTION', 'addText needs { text }.');
  const style = resolveStyle(options, { size: 12 });
  const placement = { ...options, position: options.position ?? (options.at ? undefined : 'center') };
  checkPlacement(placement);
  return stamp(input, options, style, () => [placement]);
}

/**
 * A large, faint, slanted word across the page, like DRAFT or CONFIDENTIAL.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Common & { text: string, angle?: number, position?: string, behind?: boolean }} options
 *   defaults: 64pt Helvetica-Bold, grey, 25% opacity, 45 degrees, centred, over the content
 * @returns {Promise<Uint8Array>}
 */
export async function watermark(input, options) {
  if (!options) fail('INVALID_OPTION', 'watermark needs { text }.');
  const style = resolveStyle({ font: 'Helvetica-Bold', opacity: 0.25, ...options }, { size: 64, color: '#808080' });
  const placement = { text: options.text, angle: options.angle ?? 45, position: options.position ?? 'center', behind: options.behind, margin: 0 };
  checkPlacement(placement);
  return stamp(input, options, style, () => [placement]);
}

/**
 * Number the pages. `format` may use {n} for the number and {total} for the last number, as in
 * "Page {n} of {total}". Numbering counts only the selected pages and begins at `start`.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Common & { format?: string, start?: number, position?: string, margin?: number }} [options]
 *   defaults: "{n}", from 1, bottom-center, 28pt from the edge, 10pt Helvetica
 * @returns {Promise<Uint8Array>}
 */
export async function pageNumbers(input, options = {}) {
  const style = resolveStyle(options, { size: 10 });
  const format = options.format ?? '{n}';
  const start = wholeNumber(options.start ?? 1, 'start');
  const base = { position: options.position ?? 'bottom-center', margin: options.margin ?? 28 };
  checkPlacement({ ...base, text: fill(format, { n: start, total: start }) });
  return stamp(input, options, style, (_page, index, selected) => [
    { ...base, text: fill(format, { n: start + index, total: start + selected - 1 }) },
  ]);
}

/**
 * @typedef {object} Band
 * @property {string} [left]
 * @property {string} [center]
 * @property {string} [right]
 */

/**
 * Headers and footers in three slots each. Text may use {n}, {total} and {title}.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Common & { header?: Band, footer?: Band, start?: number, margin?: number, title?: string }} options
 * @returns {Promise<Uint8Array>}
 */
export async function headerFooter(input, options) {
  if (!options || (!options.header && !options.footer)) fail('INVALID_OPTION', 'Give a header, a footer or both.');
  const style = resolveStyle(options, { size: 9 });
  const start = wholeNumber(options.start ?? 1, 'start');
  const margin = options.margin ?? 28;
  const title = options.title ?? '';
  /** @type {[string, string][]} */
  const slots = [];
  for (const [band, edge] of /** @type {const} */ ([['header', 'top'], ['footer', 'bottom']])) {
    for (const side of /** @type {const} */ (['left', 'center', 'right'])) {
      const text = options[band]?.[side];
      if (text !== undefined) slots.push([`${edge}-${side}`, text]);
    }
  }
  for (const [position, text] of slots) checkPlacement({ position, margin, text: fill(text, { n: start, total: start, title }) });
  return stamp(input, options, style, (_page, index, selected) =>
    slots.map(([position, text]) => ({ position, margin, text: fill(text, { n: start + index, total: start + selected - 1, title }) })),
  );
}

/**
 * Bates numbers: a fixed-width running number with an optional prefix and suffix, like
 * ABC000123, used to label every page of a legal production.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {Common & { prefix?: string, suffix?: string, start?: number, digits?: number, position?: string, margin?: number }} [options]
 *   defaults: no prefix, from 1, 6 digits, bottom-right, 9pt Helvetica-Bold
 * @returns {Promise<Uint8Array>}
 */
export async function bates(input, options = {}) {
  const style = resolveStyle({ font: 'Helvetica-Bold', ...options }, { size: 9 });
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? '';
  checkLatin(prefix, 'prefix');
  checkLatin(suffix, 'suffix');
  const start = wholeNumber(options.start ?? 1, 'start');
  const digits = wholeNumber(options.digits ?? 6, 'digits');
  const base = { position: options.position ?? 'bottom-right', margin: options.margin ?? 28 };
  checkPlacement({ ...base, text: prefix });
  return stamp(input, options, style, (_page, index) => [
    { ...base, text: `${prefix}${String(start + index).padStart(digits, '0')}${suffix}` },
  ]);
}

/**
 * @param {string} template
 * @param {Record<string, string | number>} values
 */
function fill(template, values) {
  if (typeof template !== 'string') fail('INVALID_OPTION', 'Header, footer and number formats must be strings.');
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole));
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function wholeNumber(value, name) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < 0 || /** @type {number} */ (value) > 1e12) {
    fail('INVALID_OPTION', `${name} must be a whole number.`);
  }
  return /** @type {number} */ (value);
}
