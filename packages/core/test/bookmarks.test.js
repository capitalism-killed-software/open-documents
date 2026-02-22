import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { getBookmarks, setBookmarks, merge, inspect } from '../src/index.js';

const doc = await textDocument({ pages: 4, rotation: [0, 0, 90, 0] });

test('reads an outline someone else wrote', async () => {
  const marked = await textDocument({
    pages: 3,
    bookmarks: [
      { title: 'Start', page: 1 },
      { title: 'Middle', page: 2 },
      { title: 'End', page: 3 },
    ],
  });
  assert.deepEqual(await getBookmarks(marked.bytes), [
    { title: 'Start', page: 1, children: [] },
    { title: 'Middle', page: 2, children: [] },
    { title: 'End', page: 3, children: [] },
  ]);
});

test('no outline is an empty list', async () => {
  assert.deepEqual(await getBookmarks(doc.bytes), []);
});

test('writes a nested outline and reads it back', async () => {
  const tree = [
    { title: 'Agreement', page: 1, children: [
      { title: '1. Parties', page: 1 },
      { title: '2. Terms', page: 2, children: [{ title: '2.1 Payment', page: 3 }] },
    ] },
    { title: 'Schedules', page: null, children: [{ title: 'Schedule A', page: 4 }] },
    { title: 'Ünïcødé – 附件', page: 4 },
  ];
  const out = await setBookmarks(doc.bytes, tree);
  assert.deepEqual(await getBookmarks(out), [
    { title: 'Agreement', page: 1, children: [
      { title: '1. Parties', page: 1, children: [] },
      { title: '2. Terms', page: 2, children: [{ title: '2.1 Payment', page: 3, children: [] }] },
    ] },
    { title: 'Schedules', page: null, children: [{ title: 'Schedule A', page: 4, children: [] }] },
    { title: 'Ünïcødé – 附件', page: 4, children: [] },
  ]);
  assert.equal((await inspect(out)).bookmarks, 3);
});

test('replacing and removing', async () => {
  const once = await setBookmarks(doc.bytes, [{ title: 'Old', page: 1 }]);
  const twice = await setBookmarks(once, [{ title: 'New', page: 2 }]);
  assert.deepEqual(await getBookmarks(twice), [{ title: 'New', page: 2, children: [] }]);
  assert.deepEqual(await getBookmarks(await setBookmarks(twice, [])), []);
});

test('merge can add one bookmark per document', async () => {
  const a = await textDocument({ pages: 2 });
  const b = await textDocument({ pages: 3 });
  const out = await merge([{ input: a.bytes, title: 'Contract' }, b.bytes, { input: a.bytes, pages: [1] }], { bookmarks: true });
  assert.deepEqual(await getBookmarks(out), [
    { title: 'Contract', page: 1, children: [] },
    { title: 'Document 2', page: 3, children: [] },
    { title: 'Document 3', page: 6, children: [] },
  ]);
  assert.deepEqual(await getBookmarks(await merge([a.bytes, b.bytes])), []);
});

test('bad bookmarks are refused', async () => {
  await assert.rejects(setBookmarks(doc.bytes, /** @type {any} */ ({ title: 'x' })), { code: 'INVALID_OPTION' });
  await assert.rejects(setBookmarks(doc.bytes, /** @type {any} */ ([{ page: 1 }])), { code: 'INVALID_OPTION' });
  await assert.rejects(setBookmarks(doc.bytes, [{ title: 'x', page: 9 }]), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(setBookmarks(doc.bytes, /** @type {any} */ ([{ title: 'x', children: 'no' }])), { code: 'INVALID_OPTION' });
  /** @type {any} */
  let deep = { title: 'leaf' };
  for (let i = 0; i < 70; i++) deep = { title: `level ${i}`, children: [deep] };
  await assert.rejects(setBookmarks(doc.bytes, [deep]), { code: 'INVALID_OPTION', message: /nest/ });
});
