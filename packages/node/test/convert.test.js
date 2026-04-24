// Runs each kind of file through toPdf. Kinds whose converter is missing are skipped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { docxDocument, xlsxDocument, odtDocument, csvDocument, emlMessage, msgMessage, pngImage, jpegImage, tiffImage, textDocument } from '@open-documents/fixtures';
import { extractText, inspect } from '@open-documents/core';
import { createConverter, findLibreOffice, createChromium } from '../src/index.js';

const converter = createConverter({ libreoffice: { slots: 2 } });
after(() => converter.close());

const noOffice = (await findLibreOffice()) ? false : 'LibreOffice is not installed';
const probe = createChromium();
const noChrome = await probe.htmlToPdf('<p>x</p>').then(() => false, (err) => (err.code === 'ENGINE_MISSING' ? 'Chromium is not installed' : Promise.reject(err)));
await probe.close();

const encode = (/** @type {string} */ s) => new TextEncoder().encode(s);
/** @param {Uint8Array} pdf */
const textOf = async (pdf) => (await extractText(pdf)).map((p) => p.text).join('\n');

test('a pdf comes back as it is', async () => {
  const { bytes } = await textDocument({ pages: 1 });
  assert.equal(await converter.toPdf(bytes), bytes);
});

test('jpeg and png become pages without any other program', async () => {
  const pdf = await converter.toPdf(pngImage({ width: 200, height: 100 }), { image: { pageSize: 'fit' } });
  assert.deepEqual((await inspect(pdf)).pages.map((p) => [p.width, p.height]), [[200, 100]]);
  assert.equal((await inspect(await converter.toPdf(new Blob([jpegImage()])))).pageCount, 1);
});

for (const [name, make] of /** @type {const} */ ([['docx', docxDocument], ['xlsx', xlsxDocument], ['odt', odtDocument]])) {
  test(`${name} goes to LibreOffice`, { skip: noOffice }, async () => {
    const doc = await make();
    const text = await textOf(await converter.toPdf(doc.bytes));
    for (const w of doc.words) assert.ok(text.includes(w), w);
  });
}

test('csv and plain text are told apart by name', { skip: noOffice }, async () => {
  assert.match(await textOf(await converter.toPdf(csvDocument().bytes, { filename: 'sales.csv' })), /North/);
  assert.match(await textOf(await converter.toPdf(encode('Just a note.'), { filename: 'note.txt' })), /Just a note\./);
});

test('a scanned tiff goes to LibreOffice and comes out one page', { skip: noOffice }, async () => {
  const pdf = await converter.toPdf(tiffImage({ width: 300, height: 200 }));
  assert.equal((await inspect(pdf)).pageCount, 1);
});

test('html, markdown and email go to Chromium', { skip: noChrome }, async () => {
  assert.match(await textOf(await converter.toPdf(encode('<!doctype html><h1>Receipt</h1>'), { format: 'a5' })), /Receipt/);
  assert.match(await textOf(await converter.toPdf(encode('# Minutes\n\n- agreed'), { filename: 'minutes.md' })), /Minutes[\s\S]*agreed/);
  assert.match(await textOf(await converter.toPdf(emlMessage().bytes)), /Site visit on Tuesday/);
  const msg = await converter.toPdf((await msgMessage()).bytes);
  assert.match(await textOf(msg), /Quarterly numbers[\s\S]*The numbers are in for the quarter\./);
  assert.match(await textOf(await converter.markdownToPdf('**bold** move')), /bold move/);
  assert.match(await textOf(await converter.htmlToPdf('<p>direct</p>')), /direct/);
});

test('files that cannot be converted are refused with a reason', async () => {
  await assert.rejects(converter.toPdf(new Uint8Array([0, 1, 2, 0, 3])), { code: 'INVALID_INPUT', message: /not recognised/ });
  await assert.rejects(converter.toPdf(new TextEncoder().encode('PK\u0005\u0006' + '\0'.repeat(18))), { code: 'INVALID_INPUT' });
  await assert.rejects(converter.toPdf(/** @type {any} */ ('text')), { code: 'INVALID_INPUT' });
});

test('compress, linearize and repair report a missing qpdf', async () => {
  const without = createConverter({ qpdf: { binary: '/nonexistent/qpdf' } });
  const { bytes } = await textDocument({ pages: 1 });
  try {
    for (const op of /** @type {const} */ (['compress', 'linearize', 'repair'])) {
      await assert.rejects(without[op](bytes), { code: 'ENGINE_MISSING' }, op);
    }
  } finally {
    await without.close();
  }
});
