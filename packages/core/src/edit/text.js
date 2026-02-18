import { stamp, resolveStyle, checkPlacement } from './stamp.js';
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
