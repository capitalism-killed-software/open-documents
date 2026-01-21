import { fail } from './errors.js';

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function numberIn(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail('INVALID_OPTION', `${name} must be a number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} pageCount
 * @returns {number} the same 1-based page number
 */
export function pageNumber(value, name, pageCount) {
  if (!Number.isInteger(value)) fail('INVALID_OPTION', `${name} must be a whole page number.`);
  const n = /** @type {number} */ (value);
  if (n < 1 || n > pageCount) {
    fail('PAGE_NOT_FOUND', `Page ${n} does not exist: the document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
  }
  return n;
}

/**
 * "#rrggbb", "#rrggbbaa" or "transparent", as 0xAARRGGBB.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
export function argbColor(value, name) {
  if (value === 'transparent') return 0;
  const match = typeof value === 'string' && /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (!match) fail('INVALID_OPTION', `${name} must be "#rrggbb", "#rrggbbaa" or "transparent".`);
  const rgb = parseInt(match[1], 16);
  const alpha = match[2] ? parseInt(match[2], 16) : 0xff;
  return ((alpha << 24) | rgb) >>> 0;
}
