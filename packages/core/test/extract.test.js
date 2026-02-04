import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { extractPages, removePages, reorder, inspect, extractText } from '../src/index.js';

const doc = await textDocument({ pages: 5, rotation: [0, 0, 90, 0, 0] });

/** @param {Uint8Array} bytes */
async function firstLines(bytes) {
  return (await extractText(bytes)).map((p) => p.text.split('\n')[0]);
}

test('extract keeps the pages asked for, in that order', async () => {
  const out = await extractPages(doc.bytes, [5, 3, 3, 1]);
  assert.deepEqual(await firstLines(out), ['Page 5 of 5', 'Page 3 of 5', 'Page 3 of 5', 'Page 1 of 5']);
  const info = await inspect(out);
  assert.deepEqual(info.pages.map((p) => p.rotation), [0, 90, 90, 0]);
  assert.equal(info.metadata.title, 'Fixture');
});

test('extract takes a page list too', async () => {
  assert.deepEqual(await firstLines(await extractPages(doc.bytes, '4-last')), ['Page 4 of 5', 'Page 5 of 5']);
});

test('extracting from an encrypted file gives an unencrypted one', async () => {
  const locked = await textDocument({ pages: 2, encrypt: { userPassword: 'open' } });
  const out = await extractPages(locked.bytes, [2], { password: 'open' });
  assert.equal((await inspect(out)).encrypted, false);
});

test('remove drops pages and keeps the rest as it was', async () => {
  const out = await removePages(doc.bytes, '2,4');
  assert.deepEqual(await firstLines(out), ['Page 1 of 5', 'Page 3 of 5', 'Page 5 of 5']);
  assert.deepEqual(await firstLines(await removePages(doc.bytes, [1, 1])), ['Page 2 of 5', 'Page 3 of 5', 'Page 4 of 5', 'Page 5 of 5']);
});

test('remove keeps encryption', async () => {
  const locked = await textDocument({ pages: 2, encrypt: { userPassword: 'open' } });
  const out = await removePages(locked.bytes, [1], { password: 'open' });
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  assert.equal((await inspect(out, { password: 'open' })).pageCount, 1);
});

test('remove refuses to empty the document', async () => {
  await assert.rejects(removePages(doc.bytes, 'all'), { code: 'INVALID_OPTION', message: /every page/ });
});

test('reorder puts every page in its new place', async () => {
  const out = await reorder(doc.bytes, [5, 4, 3, 2, 1]);
  assert.deepEqual(await firstLines(out), ['Page 5 of 5', 'Page 4 of 5', 'Page 3 of 5', 'Page 2 of 5', 'Page 1 of 5']);
  assert.deepEqual(await firstLines(await reorder(doc.bytes, 'last-1')), await firstLines(out));
  assert.equal((await inspect(out)).pages[2].rotation, 90);
});

test('reorder needs each page exactly once', async () => {
  await assert.rejects(reorder(doc.bytes, [1, 2, 3]), { code: 'INVALID_OPTION', message: /each of the 5 pages/ });
  await assert.rejects(reorder(doc.bytes, [1, 1, 2, 3, 4]), { code: 'INVALID_OPTION' });
  await assert.rejects(reorder(doc.bytes, [1, 2, 3, 4, 9]), { code: 'PAGE_NOT_FOUND' });
});

test('page lists are required', async () => {
  await assert.rejects(extractPages(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
  await assert.rejects(removePages(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
  await assert.rejects(reorder(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
});
