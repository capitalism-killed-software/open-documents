// The difference between two lists of words, as runs of kept, removed and added words.
//
// Patience diff: words that appear exactly once on both sides anchor the match, and the stretches
// between anchors are matched the same way, down to an exact longest-common-subsequence on short
// stretches. It stays fast on long documents and lines changes up the way people expect, because
// it never pairs off common words like "the" across paragraphs.

const EXACT_LIMIT = 4_000_000; // cells; beyond this a stretch counts as replaced wholesale

/**
 * @typedef {{ type: 'same' | 'removed' | 'added', a: number, b: number, length: number }} Run
 *   a and b are where the run starts on each side
 */

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Run[]}
 */
export function diffWords(a, b) {
  /** @type {Run[]} */
  const runs = [];
  /** @param {Run['type']} type @param {number} i @param {number} j @param {number} length */
  const push = (type, i, j, length) => {
    if (!length) return;
    const last = runs.at(-1);
    if (last && last.type === type && last.a + (type === 'added' ? 0 : last.length) === i && last.b + (type === 'removed' ? 0 : last.length) === j) last.length += length;
    else runs.push({ type, a: i, b: j, length });
  };
  /**
   * @param {number} a0  start in a
   * @param {number} a1  end in a
   * @param {number} b0
   * @param {number} b1
   */
  const walk = (a0, a1, b0, b1) => {
    // common start and end
    let start = 0;
    while (a0 + start < a1 && b0 + start < b1 && a[a0 + start] === b[b0 + start]) start++;
    let end = 0;
    while (a1 - end > a0 + start && b1 - end > b0 + start && a[a1 - 1 - end] === b[b1 - 1 - end]) end++;
    push('same', a0, b0, start);
    const [ia, ja, ib, jb] = [a0 + start, a1 - end, b0 + start, b1 - end];
    if (ia === ja || ib === jb) {
      push('removed', ia, ib, ja - ia);
      push('added', ja, ib, jb - ib);
    } else {
      const anchors = uniqueAnchors(a, b, ia, ja, ib, jb);
      if (anchors.length) {
        let [pa, pb] = [ia, ib];
        for (const [x, y] of anchors) {
          walk(pa, x, pb, y);
          push('same', x, y, 1);
          [pa, pb] = [x + 1, y + 1];
        }
        walk(pa, ja, pb, jb);
      } else {
        exact(ia, ja, ib, jb);
      }
    }
    push('same', a1 - end, b1 - end, end);
  };
  /** Longest common subsequence by table, for stretches with no unique anchors. */
  const exact = (/** @type {number} */ ia, /** @type {number} */ ja, /** @type {number} */ ib, /** @type {number} */ jb) => {
    const n = ja - ia;
    const m = jb - ib;
    if (n * m > EXACT_LIMIT) {
      push('removed', ia, ib, n);
      push('added', ja, ib, m);
      return;
    }
    const table = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * (m + 1) + j] = a[ia + i] === b[ib + j] ? table[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
      }
    }
    let [i, j] = [0, 0];
    while (i < n && j < m) {
      if (a[ia + i] === b[ib + j]) {
        push('same', ia + i, ib + j, 1);
        i++;
        j++;
      } else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) {
        push('removed', ia + i, ib + j, 1);
        i++;
      } else {
        push('added', ia + i, ib + j, 1);
        j++;
      }
    }
    push('removed', ia + i, ib + j, n - i);
    push('added', ia + n, ib + j, m - j);
  };
  walk(0, a.length, 0, b.length);
  return runs;
}

/**
 * Words found exactly once on each side, paired up and thinned to the longest run that keeps
 * the same order on both sides.
 *
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} ia
 * @param {number} ja
 * @param {number} ib
 * @param {number} jb
 * @returns {[number, number][]}
 */
function uniqueAnchors(a, b, ia, ja, ib, jb) {
  /** @type {Map<string, number>} word to its index, or -1 when it repeats */
  const inA = new Map();
  for (let i = ia; i < ja; i++) inA.set(a[i], inA.has(a[i]) ? -1 : i);
  /** @type {Map<string, number>} */
  const inB = new Map();
  for (let j = ib; j < jb; j++) inB.set(b[j], inB.has(b[j]) ? -1 : j);
  /** @type {[number, number][]} */
  const pairs = [];
  for (let j = ib; j < jb; j++) {
    const i = inA.get(b[j]);
    if (i !== undefined && i >= 0 && inB.get(b[j]) === j) pairs.push([i, j]);
  }
  // pairs are in b's order; keep the longest run increasing in a (patience sorting)
  /** @type {number[]} */
  const tails = [];
  /** @type {number[]} */
  const before = new Array(pairs.length);
  pairs.forEach(([i], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][0] < i) lo = mid + 1;
      else hi = mid;
    }
    before[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  });
  /** @type {[number, number][]} */
  const out = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = before[k]) out.push(pairs[k]);
  return out.reverse();
}
