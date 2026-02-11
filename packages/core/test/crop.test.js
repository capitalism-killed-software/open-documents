import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { crop, inspect, renderPage } from '../src/index.js';
import { difference, busyLines } from './helpers/pixels.js';

for (const rotation of [0, 90, 180, 270]) {
  test(`margins trim the page as shown, turned ${rotation}`, async () => {
    const doc = await textDocument({ pages: 1, rotation, lines: busyLines });
    const whole = await renderPage(doc.bytes, { dpi: 72, format: 'rgba' });
    const out = await crop(doc.bytes, { margins: { top: 100, left: 40, right: 20, bottom: 60 } });
    const kept = await renderPage(out, { dpi: 72, format: 'rgba' });
    assert.equal(kept.width, whole.width - 60);
    assert.equal(kept.height, whole.height - 160);
    const share = difference(whole, kept, 40, 100);
    assert.ok(share < 0.005, `${(share * 100).toFixed(2)}% of pixels differ`);
  });
}

test('one number trims every edge; box keeps an exact area', async () => {
  const doc = await textDocument({ pages: 2 });
  const even = await inspect(await crop(doc.bytes, { margins: 72 }));
  assert.deepEqual([even.pages[0].width, even.pages[0].height], [468, 648]);
  const boxed = await inspect(await crop(doc.bytes, { box: { x: 0, y: 0, width: 306, height: 396 }, pages: [2] }));
  assert.deepEqual(boxed.pages.map((p) => [p.width, p.height]), [[612, 792], [306, 396]]);
});

test('cropping twice works on what is left', async () => {
  const doc = await textDocument({ pages: 1 });
  const once = await crop(doc.bytes, { margins: 100 });
  const twice = await inspect(await crop(once, { margins: { left: 12 } }));
  assert.deepEqual([twice.pages[0].width, twice.pages[0].height], [400, 592]);
});

test('areas outside the page, or both kinds of option, are refused', async () => {
  const doc = await textDocument({ pages: 1 });
  await assert.rejects(crop(doc.bytes, { margins: 400 }), { code: 'INVALID_OPTION', message: /612 x 792/ });
  await assert.rejects(crop(doc.bytes, { box: { x: 600, y: 0, width: 100, height: 100 } }), { code: 'INVALID_OPTION' });
  await assert.rejects(crop(doc.bytes, { box: { x: -1, y: 0, width: 10, height: 10 } }), { code: 'INVALID_OPTION' });
  await assert.rejects(crop(doc.bytes, { margins: Number.NaN }), { code: 'INVALID_OPTION' });
  await assert.rejects(crop(doc.bytes, { margins: 1, box: { x: 0, y: 0, width: 1, height: 1 } }), { code: 'INVALID_OPTION' });
  await assert.rejects(crop(doc.bytes, /** @type {any} */ ({})), { code: 'INVALID_OPTION' });
  await assert.rejects(crop(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
});
