import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from '@cantoo/pdf-lib';
import { textDocument } from '../src/index.js';

test('same options give the same bytes', async () => {
  const a = await textDocument({ pages: 2 });
  const b = await textDocument({ pages: 2 });
  assert.deepEqual(a.bytes, b.bytes);
});

test('truth matches what was written', async () => {
  const { bytes, truth } = await textDocument({ pages: 4, size: 'a4', rotation: [0, 90, 180, 270] });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 4);
  assert.equal(truth.pages.length, 4);
  doc.getPages().forEach((page, i) => {
    assert.equal(page.getRotation().angle, truth.pages[i].rotation);
    assert.equal(page.getWidth(), truth.pages[i].width);
  });
  assert.equal(doc.getTitle(), 'Fixture');
  assert.deepEqual(truth.pages[2].lines, ['Page 3 of 4', 'The quick brown fox jumps over the lazy dog.']);
});

test('custom lines and metadata', async () => {
  const { bytes, truth } = await textDocument({
    pages: 1,
    lines: () => ['only line'],
    metadata: { title: 'Other' },
  });
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), 'Other');
  assert.deepEqual(truth.pages[0].lines, ['only line']);
  assert.equal(truth.metadata.author, 'Open Documents fixtures');
});
