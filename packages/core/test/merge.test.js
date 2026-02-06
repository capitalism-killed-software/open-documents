import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { merge, inspect, extractText } from '../src/index.js';

const a = await textDocument({ pages: 2, lines: (n) => [`A${n}`], metadata: { title: 'First' } });
const b = await textDocument({ pages: 3, size: 'a4', lines: (n) => [`B${n}`], metadata: { title: 'Second' } });
const c = await textDocument({ pages: 1, rotation: 90, lines: () => ['C1'] });

/** @param {Uint8Array} bytes */
const texts = async (bytes) => (await extractText(bytes)).map((p) => p.text);

test('joins documents in order, pages and sizes intact', async () => {
  const out = await merge([a.bytes, b.bytes, c.bytes]);
  assert.deepEqual(await texts(out), ['A1', 'A2', 'B1', 'B2', 'B3', 'C1']);
  const info = await inspect(out);
  assert.equal(info.pages[0].width, 612);
  assert.equal(info.pages[2].width, 595.28);
  assert.equal(info.pages[5].rotation, 90);
  assert.equal(info.metadata.title, 'First');
});

test('takes only the pages asked for from each', async () => {
  const out = await merge([{ input: b.bytes, pages: 'last-1' }, { input: a.bytes, pages: [2] }, a.bytes]);
  assert.deepEqual(await texts(out), ['B3', 'B2', 'B1', 'A2', 'A1', 'A2']);
});

test('the same document can go in twice, and Blobs work', async () => {
  assert.deepEqual(await texts(await merge([new Blob([c.bytes]), c.bytes])), ['C1', 'C1']);
});

test('encrypted inputs need their passwords', async () => {
  const locked = await textDocument({ pages: 1, lines: () => ['L1'], encrypt: { userPassword: 'open' } });
  await assert.rejects(merge([a.bytes, locked.bytes]), { code: 'PASSWORD_REQUIRED' });
  const out = await merge([a.bytes, { input: locked.bytes, password: 'open' }]);
  assert.deepEqual(await texts(out), ['A1', 'A2', 'L1']);
  assert.equal((await inspect(out)).encrypted, false);
});

test('bad input is refused', async () => {
  await assert.rejects(merge([]), { code: 'INVALID_OPTION' });
  await assert.rejects(merge(/** @type {any} */ (a.bytes)), { code: 'INVALID_OPTION' });
  await assert.rejects(merge([a.bytes, new Uint8Array([1, 2, 3])]), { code: 'INVALID_INPUT' });
  await assert.rejects(merge([{ input: a.bytes, pages: [3] }]), { code: 'PAGE_NOT_FOUND' });
});
