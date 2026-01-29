import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument, formDocument } from '@open-documents/fixtures';
import { inspect, configure, OpenDocumentsError } from '../src/index.js';

test('pages, sizes and rotation', async () => {
  const { bytes, truth } = await textDocument({ pages: 4, size: 'a4', rotation: [0, 90, 180, 270] });
  const info = await inspect(bytes);
  assert.equal(info.pageCount, 4);
  info.pages.forEach((page, i) => {
    const t = truth.pages[i];
    const turned = t.rotation % 180 !== 0;
    assert.equal(page.number, i + 1);
    assert.equal(page.rotation, t.rotation);
    assert.equal(page.width, turned ? t.height : t.width);
    assert.equal(page.height, turned ? t.width : t.height);
  });
});

test('metadata and document facts', async () => {
  const { bytes, truth } = await textDocument({ pages: 1 });
  const info = await inspect(bytes);
  assert.equal(info.version, '1.7');
  assert.equal(info.metadata.title, truth.metadata.title);
  assert.equal(info.metadata.author, truth.metadata.author);
  assert.equal(info.metadata.creationDate, 'D:20200101000000Z');
  assert.equal(info.encrypted, false);
  assert.equal(info.permissions, -1);
  assert.equal(info.forms, 'none');
  assert.equal(info.tagged, false);
  assert.equal(info.signatures, 0);
  assert.equal(info.attachments, 0);
  assert.equal(info.bookmarks, 0);
});

test('encrypted files need the password', async () => {
  const { bytes } = await textDocument({
    pages: 2,
    encrypt: { userPassword: 'open', permissions: { printing: true, copying: false } },
  });
  await assert.rejects(inspect(bytes), { code: 'PASSWORD_REQUIRED' });
  await assert.rejects(inspect(bytes, { password: 'wrong' }), { code: 'PASSWORD_REQUIRED' });
  const info = await inspect(bytes, { password: 'open' });
  assert.equal(info.pageCount, 2);
  assert.equal(info.encrypted, true);
  assert.notEqual(info.permissions, -1);
  assert.equal(info.permissions & 0b10000, 0, 'copying is not allowed');
  assert.notEqual(info.permissions & 0b100, 0, 'printing is allowed');
});

test('forms, bookmarks and attachments are counted', async () => {
  const form = await formDocument();
  assert.equal((await inspect(form.bytes)).forms, 'acroform');
  const { bytes } = await textDocument({
    pages: 3,
    bookmarks: [
      { title: 'Start', page: 1 },
      { title: 'Middle', page: 2 },
      { title: 'End', page: 3 },
    ],
    attachments: [{ name: 'notes.txt', data: new TextEncoder().encode('hello') }],
  });
  const info = await inspect(bytes);
  assert.equal(info.bookmarks, 3);
  assert.equal(info.attachments, 1);
});

test('accepts ArrayBuffer and Blob as well as bytes', async () => {
  const { bytes } = await textDocument({ pages: 2 });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal((await inspect(buffer)).pageCount, 2);
  assert.equal((await inspect(new Blob([bytes]))).pageCount, 2);
});

test('refuses things that are not PDFs', async () => {
  await assert.rejects(inspect(new TextEncoder().encode('hello')), { code: 'INVALID_INPUT' });
  await assert.rejects(inspect(/** @type {any} */ ('a string')), { code: 'INVALID_INPUT' });
});

test('a damaged file is reported, not crashed on', async () => {
  const junk = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> nonsense');
  await assert.rejects(inspect(junk), (err) => {
    assert.ok(err instanceof OpenDocumentsError);
    assert.equal(err.code, 'DAMAGED_FILE');
    return true;
  });
});

test('the header may come after some junk', async () => {
  const { bytes } = await textDocument({ pages: 1 });
  const padded = new Uint8Array(bytes.length + 10);
  padded.set(new TextEncoder().encode('junkjunk\r\n'));
  padded.set(bytes, 10);
  assert.equal((await inspect(padded)).pageCount, 1);
});

test('configure is refused once the engine is loaded', async () => {
  const { bytes } = await textDocument({ pages: 1 });
  await inspect(bytes);
  assert.throws(() => configure({ wasmUrl: 'https://example.com/pdfium.wasm' }), { code: 'INVALID_OPTION' });
});
