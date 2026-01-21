import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { textDocument } from '@open-documents/fixtures';
import { renderPage } from '../src/index.js';

const letter = await textDocument({ pages: 2, rotation: [0, 90] });

/**
 * Independent check of our PNG output: parse chunks, inflate, undo the filters we use.
 * @param {Uint8Array} png
 */
function decodePng(png) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    }
    if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 4;
  const rgba = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    assert.equal(filter, 1, 'expected the Sub filter');
    for (let x = 0; x < rowBytes; x++) {
      const left = x >= 4 ? rgba[y * rowBytes + x - 4] : 0;
      rgba[y * rowBytes + x] = (raw[y * (rowBytes + 1) + 1 + x] + left) & 0xff;
    }
  }
  return { width, height, rgba };
}

/**
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} x
 * @param {number} y
 */
function pixel(rgba, width, x, y) {
  const i = (y * width + x) * 4;
  return [...rgba.subarray(i, i + 4)];
}

test('one pixel per point at 72 dpi, white page, dark text where it was drawn', async () => {
  const out = await renderPage(letter.bytes, { dpi: 72, format: 'rgba' });
  assert.equal(out.page, 1);
  assert.equal(out.width, 612);
  assert.equal(out.height, 792);
  assert.equal(out.data.length, 612 * 792 * 4);
  assert.deepEqual(pixel(out.data, 612, 5, 5), [255, 255, 255, 255]);
  // the first line sits on the baseline 72pt from the top, so its glyphs are just above row 72
  let dark = 0;
  for (let y = 60; y < 74; y++) {
    for (let x = 72; x < 200; x++) if (pixel(out.data, 612, x, y)[0] < 128) dark++;
  }
  assert.ok(dark > 50, `expected text pixels, found ${dark}`);
});

test('dpi and width scale the image', async () => {
  const big = await renderPage(letter.bytes, { dpi: 144, format: 'rgba' });
  assert.equal(big.width, 1224);
  assert.equal(big.height, 1584);
  const fitted = await renderPage(letter.bytes, { width: 306, format: 'rgba' });
  assert.equal(fitted.width, 306);
  assert.equal(fitted.height, 396);
});

test('rotation is applied', async () => {
  const out = await renderPage(letter.bytes, { page: 2, dpi: 72, format: 'rgba' });
  assert.equal(out.width, 792);
  assert.equal(out.height, 612);
});

test('png output decodes to the same pixels', async () => {
  const png = await renderPage(letter.bytes, { dpi: 36 });
  const rgba = await renderPage(letter.bytes, { dpi: 36, format: 'rgba' });
  assert.equal(png.format, 'png');
  assert.deepEqual([...png.data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const decoded = decodePng(png.data);
  assert.equal(decoded.width, rgba.width);
  assert.equal(decoded.height, rgba.height);
  assert.deepEqual(decoded.rgba, rgba.data);
  assert.ok(png.data.length < rgba.data.length / 10, 'a mostly white page should compress well');
});

test('transparent and coloured backgrounds', async () => {
  const clear = await renderPage(letter.bytes, { dpi: 10, format: 'rgba', background: 'transparent' });
  assert.equal(pixel(clear.data, clear.width, 1, 1)[3], 0);
  const red = await renderPage(letter.bytes, { dpi: 10, format: 'rgba', background: '#ff000080' });
  assert.deepEqual(pixel(red.data, red.width, 1, 1), [255, 0, 0, 0x80]);
  const blue = await renderPage(letter.bytes, { dpi: 10, format: 'rgba', background: '#0000ff' });
  assert.deepEqual(pixel(blue.data, blue.width, 1, 1), [0, 0, 255, 255]);
});

test('annotations can be left out', async () => {
  const out = await renderPage(letter.bytes, { dpi: 10, format: 'rgba', annotations: false });
  assert.equal(out.width, 85);
});

test('refuses renders that are too big', async () => {
  await assert.rejects(renderPage(letter.bytes, { dpi: 600, maxPixels: 1_000_000 }), {
    code: 'INVALID_OPTION',
    message: /pixel limit/,
  });
});

test('page numbers are checked', async () => {
  await assert.rejects(renderPage(letter.bytes, { page: 3 }), { code: 'PAGE_NOT_FOUND', message: /2 pages/ });
  await assert.rejects(renderPage(letter.bytes, { page: 0 }), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(renderPage(letter.bytes, { page: 1.5 }), { code: 'INVALID_OPTION' });
});

test('bad options are refused', async () => {
  await assert.rejects(renderPage(letter.bytes, { format: /** @type {any} */ ('gif') }), { code: 'INVALID_OPTION' });
  await assert.rejects(renderPage(letter.bytes, { background: 'red' }), { code: 'INVALID_OPTION' });
  await assert.rejects(renderPage(letter.bytes, { dpi: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(renderPage(letter.bytes, { dpi: Number.NaN }), { code: 'INVALID_OPTION' });
  await assert.rejects(renderPage(letter.bytes, { width: -5 }), { code: 'INVALID_OPTION' });
});

test('one-page documents say "1 page"', async () => {
  const single = await textDocument({ pages: 1 });
  await assert.rejects(renderPage(single.bytes, { page: 2 }), { message: /has 1 page\./ });
});
