import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pngImage, jpegImage } from '@open-documents/fixtures';
import { imagesToPdf, inspect, renderPage } from '../src/index.js';

/**
 * Colour at a point of a 72 dpi render, as 'red', 'blue', 'white' or 'other'.
 * @param {{ data: Uint8Array, width: number }} img
 * @param {number} x
 * @param {number} y
 */
function colourAt(img, x, y) {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  const [r, g, b] = img.data.subarray(i, i + 3);
  if (r > 200 && g < 80 && b < 80) return 'red';
  if (b > 200 && r < 80 && g < 80) return 'blue';
  if (r > 240 && g > 240 && b > 240) return 'white';
  return 'other';
}

test('one letter page per image, landscape for wide images, image centred and fitted', async () => {
  const out = await imagesToPdf([pngImage({ width: 400, height: 200 }), pngImage({ width: 100, height: 300 })]);
  const info = await inspect(out);
  assert.deepEqual(info.pages.map((p) => [p.width, p.height]), [[792, 612], [612, 792]]);
  assert.equal(info.metadata.producer, 'Open Documents');
  const first = await renderPage(out, { dpi: 72, format: 'rgba' });
  // 400 x 200 scaled to fit 792 x 612 is 792 x 396, centred vertically
  assert.equal(colourAt(first, 10, 306), 'red');
  assert.equal(colourAt(first, 780, 306), 'blue');
  assert.equal(colourAt(first, 396, 50), 'white');
});

test('"fit" pages are the size of the image', async () => {
  const out = await imagesToPdf([pngImage({ width: 300, height: 150 })], { pageSize: 'fit', dpi: 150 });
  const [page] = (await inspect(out)).pages;
  assert.deepEqual([page.width, page.height], [144, 72]);
});

test('margins, fixed orientation and custom sizes', async () => {
  const out = await imagesToPdf([pngImage({ width: 400, height: 200 })], { pageSize: 'a4', orientation: 'portrait', margin: 36, title: 'Scans' });
  const info = await inspect(out);
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [595.28, 841.89]);
  assert.equal(info.metadata.title, 'Scans');
  const img = await renderPage(out, { dpi: 72, format: 'rgba' });
  assert.equal(colourAt(img, 20, 420), 'white', 'inside the margin is empty');
  assert.equal(colourAt(img, 40, 420), 'red');
  const custom = await inspect(await imagesToPdf([pngImage()], { pageSize: [300, 200], orientation: 'landscape' }));
  assert.deepEqual([custom.pages[0].width, custom.pages[0].height], [300, 200]);
});

for (const [orientation, top, bottom, left, right] of [
  [1, null, null, 'red', 'blue'],
  [6, 'red', 'blue', null, null],
  [3, null, null, 'blue', 'red'],
  [8, 'blue', 'red', null, null],
]) {
  test(`JPEG photos are turned by their EXIF orientation ${orientation}`, async () => {
    const photo = jpegImage({ width: 64, height: 32, orientation: /** @type {number} */ (orientation) });
    const out = await imagesToPdf([photo], { pageSize: 'fit' });
    const img = await renderPage(out, { dpi: 72, format: 'rgba' });
    const turned = orientation === 6 || orientation === 8;
    assert.deepEqual([img.width, img.height], turned ? [32, 64] : [64, 32]);
    if (top) {
      assert.equal(colourAt(img, 16, 8), top);
      assert.equal(colourAt(img, 16, 56), bottom);
    } else {
      assert.equal(colourAt(img, 8, 16), left);
      assert.equal(colourAt(img, 56, 16), right);
    }
  });
}

test('JPEG without EXIF and Blob input', async () => {
  const out = await imagesToPdf([new Blob([jpegImage({ width: 20, height: 40 })])], { pageSize: 'fit' });
  assert.deepEqual((await inspect(out)).pages.map((p) => [p.width, p.height]), [[20, 40]]);
});

test('other files and bad options are refused', async () => {
  await assert.rejects(imagesToPdf([]), { code: 'INVALID_OPTION' });
  await assert.rejects(imagesToPdf([new TextEncoder().encode('GIF89a')]), { code: 'INVALID_INPUT', message: /JPEG or PNG/ });
  await assert.rejects(imagesToPdf([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])]), { code: 'INVALID_INPUT', message: /could not be read/ });
  await assert.rejects(imagesToPdf([pngImage()], { pageSize: /** @type {any} */ ('tabloid') }), { code: 'INVALID_OPTION' });
  await assert.rejects(imagesToPdf([pngImage()], { orientation: /** @type {any} */ ('sideways') }), { code: 'INVALID_OPTION' });
  await assert.rejects(imagesToPdf([pngImage()], { margin: 400 }), { code: 'INVALID_OPTION', message: /no room/ });
  await assert.rejects(imagesToPdf([pngImage()], { pageSize: [0, 100] }), { code: 'INVALID_OPTION' });
});
