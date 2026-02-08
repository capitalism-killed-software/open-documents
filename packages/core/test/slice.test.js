import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { slicePages, renderPage, inspect } from '../src/index.js';

/**
 * Lines spread over the page so every piece has something on it.
 * @param {number} n
 */
const lines = (n) => Array.from({ length: 40 }, (_, i) => `Page ${n} line ${i + 1} `.repeat(4));

/**
 * The share of pixels that differ noticeably between a piece and the same area of the whole.
 * @param {{ data: Uint8Array, width: number }} whole
 * @param {{ data: Uint8Array, width: number, height: number }} piece
 * @param {number} left
 * @param {number} top
 */
function difference(whole, piece, left, top) {
  let differ = 0;
  for (let y = 0; y < piece.height; y++) {
    for (let x = 0; x < piece.width; x++) {
      const a = ((top + y) * whole.width + left + x) * 4;
      const b = (y * piece.width + x) * 4;
      if (Math.abs(whole.data[a] - piece.data[b]) > 40) differ++;
    }
  }
  return differ / (piece.width * piece.height);
}

for (const rotation of [0, 90, 180, 270]) {
  test(`pieces match the same area of the whole page, turned ${rotation}`, async () => {
    const doc = await textDocument({ pages: 1, rotation, lines });
    const whole = await renderPage(doc.bytes, { dpi: 72, format: 'rgba' });
    const out = await slicePages(doc.bytes, { columns: 2, rows: 2 });
    const info = await inspect(out);
    assert.equal(info.pageCount, 4);
    for (let k = 0; k < 4; k++) {
      const piece = await renderPage(out, { page: k + 1, dpi: 72, format: 'rgba' });
      assert.equal(piece.width, whole.width / 2);
      assert.equal(piece.height, whole.height / 2);
      const left = (k % 2) * piece.width;
      const top = Math.floor(k / 2) * piece.height;
      const share = difference(whole, piece, left, top);
      assert.ok(share < 0.005, `piece ${k + 1}: ${(share * 100).toFixed(2)}% of pixels differ`);
    }
  });
}

test('halves pages by default and keeps unselected pages whole', async () => {
  const doc = await textDocument({ pages: 3 });
  const out = await slicePages(doc.bytes, { pages: [2] });
  const info = await inspect(out);
  assert.deepEqual(info.pages.map((p) => [p.width, p.height]), [[612, 792], [306, 792], [306, 792], [612, 792]]);
  assert.equal(info.metadata.title, 'Fixture');
});

test('pieces in a tall grid', async () => {
  const doc = await textDocument({ pages: 1 });
  const info = await inspect(await slicePages(doc.bytes, { columns: 1, rows: 3 }));
  assert.deepEqual(info.pages.map((p) => [p.width, p.height]), [[612, 264], [612, 264], [612, 264]]);
});

test('bad grids are refused', async () => {
  const doc = await textDocument({ pages: 1 });
  await assert.rejects(slicePages(doc.bytes, { columns: 1, rows: 1 }), { code: 'INVALID_OPTION' });
  await assert.rejects(slicePages(doc.bytes, { columns: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(slicePages(doc.bytes, { rows: 1.5 }), { code: 'INVALID_OPTION' });
  await assert.rejects(slicePages(doc.bytes, { columns: 51 }), { code: 'INVALID_OPTION' });
});
