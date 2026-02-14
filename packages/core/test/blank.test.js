import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { insertBlankPages, inspect, extractText } from '../src/index.js';

const doc = await textDocument({ pages: 3, lines: (n) => [`P${n}`], rotation: [0, 90, 0] });

/** @param {Uint8Array} bytes */
const texts = async (bytes) => (await extractText(bytes)).map((p) => p.text);

test('at the front, in the middle and at the end', async () => {
  assert.deepEqual(await texts(await insertBlankPages(doc.bytes, { at: 1 })), ['', 'P1', 'P2', 'P3']);
  assert.deepEqual(await texts(await insertBlankPages(doc.bytes, { at: 3, count: 2 })), ['P1', 'P2', '', '', 'P3']);
  assert.deepEqual(await texts(await insertBlankPages(doc.bytes, { at: 4 })), ['P1', 'P2', 'P3', '']);
});

test('blank pages take the size of their neighbour, or the size given', async () => {
  const before2 = await inspect(await insertBlankPages(doc.bytes, { at: 2 }));
  assert.deepEqual([before2.pages[1].width, before2.pages[1].height], [792, 612]);
  assert.equal(before2.pages[1].rotation, 0);
  const sized = await inspect(await insertBlankPages(doc.bytes, { at: 4, size: [200, 300] }));
  assert.deepEqual([sized.pages[3].width, sized.pages[3].height], [200, 300]);
});

test('bad positions and counts are refused', async () => {
  await assert.rejects(insertBlankPages(doc.bytes, { at: 0 }), { code: 'INVALID_OPTION', message: /1 to 4/ });
  await assert.rejects(insertBlankPages(doc.bytes, { at: 5 }), { code: 'INVALID_OPTION' });
  await assert.rejects(insertBlankPages(doc.bytes, { at: 1, count: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(insertBlankPages(doc.bytes, { at: 1, size: [0, 10] }), { code: 'INVALID_OPTION' });
  await assert.rejects(insertBlankPages(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
});
