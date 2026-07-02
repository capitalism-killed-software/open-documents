// Small pieces shared by the Word and PowerPoint writers.
import { zipSync } from 'fflate';

export const EMU_PER_POINT = 12700;
// One date for every file in the zip, so the same input always gives the same bytes. Zip
// stores local time, so this is midnight wherever it runs.
const MTIME = new Date(2000, 0, 1);

/**
 * Text for XML, without the characters XML 1.0 cannot hold.
 *
 * @param {string} text
 */
export function xml(text) {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {number} points */
export const emu = (points) => Math.round(points * EMU_PER_POINT);

/**
 * Where a box of `width` by `height` must sit, unturned, so that turned by `angle` (degrees
 * clockwise, about its centre) its top left corner lands on the baseline start minus `ascent`.
 *
 * @param {{ x: number, y: number, angle: number }} at  baseline start, as shown
 * @param {number} width
 * @param {number} height
 * @param {number} ascent  from the top of the box to the baseline
 */
export function placeBox(at, width, height, ascent) {
  const a = (at.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // the centre, measured along the baseline and across it (across points down the page)
  const along = width / 2;
  const across = height / 2 - ascent;
  const cx = at.x + along * dx - across * dy;
  const cy = at.y + along * dy + across * dx;
  return { x: cx - width / 2, y: cy - height / 2 };
}

/**
 * @param {Record<string, string | Uint8Array>} files  path to XML text or bytes
 */
export function zipOffice(files) {
  /** @type {Record<string, [Uint8Array, { mtime: Date, level: 0 | 6 }]>} */
  const entries = {};
  const encoder = new TextEncoder();
  for (const [path, body] of Object.entries(files)) {
    const bytes = typeof body === 'string' ? encoder.encode(body) : body;
    entries[path] = [bytes, { mtime: MTIME, level: typeof body === 'string' ? 6 : 0 }];
  }
  return zipSync(entries);
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
