/**
 * The share of pixels that differ noticeably between `part` and the area of `whole` whose top
 * left corner is at (left, top). Both are RGBA renders.
 *
 * @param {{ data: Uint8Array, width: number }} whole
 * @param {{ data: Uint8Array, width: number, height: number }} part
 * @param {number} left
 * @param {number} top
 */
export function difference(whole, part, left, top) {
  let differ = 0;
  for (let y = 0; y < part.height; y++) {
    for (let x = 0; x < part.width; x++) {
      const a = ((top + y) * whole.width + left + x) * 4;
      const b = (y * part.width + x) * 4;
      if (Math.abs(whole.data[a] - part.data[b]) > 40) differ++;
    }
  }
  return differ / (part.width * part.height);
}

/** Lines spread over the page so any area of it has something drawn. @param {number} n */
export const busyLines = (n) => Array.from({ length: 40 }, (_, i) => `Page ${n} line ${i + 1} `.repeat(4));
