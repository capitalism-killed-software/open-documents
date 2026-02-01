import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from '@cantoo/pdf-lib';
import { textDocument } from '@open-documents/fixtures';
import { rotate, inspect, extractText } from '../src/index.js';

const doc = await textDocument({ pages: 3 });

test('turns every page and keeps the text', async () => {
  const out = await rotate(doc.bytes, { angle: 90 });
  const info = await inspect(out);
  assert.deepEqual(info.pages.map((p) => p.rotation), [90, 90, 90]);
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [792, 612]);
  assert.deepEqual(await extractText(out), await extractText(doc.bytes));
});

test('adds to the rotation a page already has', async () => {
  const once = await rotate(doc.bytes, { angle: 90, pages: [2] });
  const back = await rotate(once, { angle: -90, pages: '2' });
  const twice = await rotate(once, { angle: 270, pages: [2, 3] });
  assert.deepEqual((await inspect(once)).pages.map((p) => p.rotation), [0, 90, 0]);
  assert.deepEqual((await inspect(back)).pages.map((p) => p.rotation), [0, 0, 0]);
  assert.deepEqual((await inspect(twice)).pages.map((p) => p.rotation), [0, 0, 270]);
  assert.deepEqual((await inspect(await rotate(doc.bytes, { angle: 450 }))).pages[0].rotation, 90);
});

test('the result is a normal PDF other tools can read', async () => {
  const out = await rotate(doc.bytes, { angle: 180 });
  const reread = await PDFDocument.load(out);
  assert.equal(reread.getPageCount(), 3);
  assert.equal(reread.getPage(0).getRotation().angle, 180);
});

test('an encrypted file stays encrypted', async () => {
  const locked = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  const out = await rotate(locked.bytes, { angle: 90, password: 'open' });
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  assert.equal((await inspect(out, { password: 'open' })).pages[0].rotation, 90);
});

test('only quarter turns', async () => {
  await assert.rejects(rotate(doc.bytes, { angle: 45 }), { code: 'INVALID_OPTION' });
  await assert.rejects(rotate(doc.bytes, /** @type {any} */ ({})), { code: 'INVALID_OPTION' });
  await assert.rejects(rotate(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
  await assert.rejects(rotate(doc.bytes, { angle: 90, pages: [4] }), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(rotate(doc.bytes, { angle: 90, pages: /** @type {any} */ (2) }), { code: 'INVALID_OPTION' });
});
