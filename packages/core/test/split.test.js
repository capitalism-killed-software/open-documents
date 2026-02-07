import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { split, extractText, inspect } from '../src/index.js';

const doc = await textDocument({ pages: 7, lines: (n) => [`P${n}`] });

/** @param {Uint8Array[]} parts */
const texts = async (parts) => Promise.all(parts.map(async (p) => (await extractText(p)).map((x) => x.text).join(',')));

test('every page on its own by default', async () => {
  const parts = await split(doc.bytes);
  assert.equal(parts.length, 7);
  assert.deepEqual(await texts(parts), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  assert.equal((await inspect(parts[3])).metadata.title, 'Fixture');
});

test('every N pages, with a short last part', async () => {
  assert.deepEqual(await texts(await split(doc.bytes, { every: 3 })), ['P1,P2,P3', 'P4,P5,P6', 'P7']);
  assert.deepEqual(await texts(await split(doc.bytes, { every: 10 })), ['P1,P2,P3,P4,P5,P6,P7']);
});

test('by ranges, which may overlap or skip', async () => {
  const parts = await split(doc.bytes, { ranges: ['1-2', [7, 1], 'odd'] });
  assert.deepEqual(await texts(parts), ['P1,P2', 'P7,P1', 'P1,P3,P5,P7']);
});

test('at given pages', async () => {
  assert.deepEqual(await texts(await split(doc.bytes, { at: [3, 6] })), ['P1,P2', 'P3,P4,P5', 'P6,P7']);
  assert.deepEqual(await texts(await split(doc.bytes, { at: [6, 3, 1, 3] })), ['P1,P2', 'P3,P4,P5', 'P6,P7']);
});

test('bad options are refused', async () => {
  await assert.rejects(split(doc.bytes, { every: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(split(doc.bytes, { every: 2, at: [3] }), { code: 'INVALID_OPTION', message: /only one/ });
  await assert.rejects(split(doc.bytes, { ranges: [] }), { code: 'INVALID_OPTION' });
  await assert.rejects(split(doc.bytes, { at: /** @type {any} */ (3) }), { code: 'INVALID_OPTION' });
  await assert.rejects(split(doc.bytes, { at: [8] }), { code: 'PAGE_NOT_FOUND' });
});
