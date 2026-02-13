import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { nUp, inspect, extractWords } from '../src/index.js';

const doc = await textDocument({ pages: 5, lines: (n) => [`P${n}`] });

test('two pages per landscape sheet by default, left then right', async () => {
  const out = await nUp(doc.bytes);
  const info = await inspect(out);
  assert.equal(info.pageCount, 3);
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [792, 612]);
  assert.equal(info.metadata.title, 'Fixture');
  const [sheet] = await extractWords(out, { pages: [1] });
  const p1 = sheet.words.find((w) => w.text === 'P1');
  const p2 = sheet.words.find((w) => w.text === 'P2');
  assert.ok(p1 && p2 && p1.x < 396 && p2.x > 396, 'P1 on the left half, P2 on the right');
});

test('a 2 x 2 grid keeps portrait, rows top to bottom', async () => {
  const out = await nUp(doc.bytes, { columns: 2, rows: 2 });
  const info = await inspect(out);
  assert.equal(info.pageCount, 2);
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [612, 792]);
  const [sheet] = await extractWords(out, { pages: [1] });
  const at = (/** @type {string} */ t) => /** @type {import('../src/text.js').Word} */ (sheet.words.find((w) => w.text === t));
  assert.ok(at('P1').y < 396 && at('P3').y > 396, 'P3 starts the second row');
  assert.ok(at('P2').x > at('P1').x);
});

test('a sheet size can be given', async () => {
  const info = await inspect(await nUp(doc.bytes, { columns: 1, rows: 2, pageSize: [595.28, 841.89] }));
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [595.28, 841.89]);
});

test('bad layouts are refused', async () => {
  await assert.rejects(nUp(doc.bytes, { columns: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(nUp(doc.bytes, { rows: 17 }), { code: 'INVALID_OPTION' });
  await assert.rejects(nUp(doc.bytes, { pageSize: [10, 10] }), { code: 'INVALID_OPTION' });
});
