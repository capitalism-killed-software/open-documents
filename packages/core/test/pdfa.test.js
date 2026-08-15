import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { textDocument } from '@open-documents/fixtures';
import { checkPdfA, toPdfA, encrypt, renderPage, inspect, setMetadata } from '../src/index.js';
import { srgbProfile, xmpPacket } from '../src/pdfa.js';

const doc = (await textDocument({ pages: 2 })).bytes;

/** @param {import('../src/pdfa.js').PdfACheck} check */
const codes = (check) => check.problems.map((p) => p.code);

test('the usual problems are found', async () => {
  const check = await checkPdfA(doc);
  assert.equal(check.claimed, null);
  assert.deepEqual(codes(check), ['FONT_NOT_EMBEDDED', 'NO_PDFA_ID', 'NO_OUTPUT_INTENT']);
  assert.deepEqual(check.problems[0].pages, [1, 2]);
  assert.match(check.problems[0].message, /Helvetica/);
  const locked = await encrypt(doc, { userPassword: 'pw' });
  assert.equal(codes(await checkPdfA(locked, { password: 'pw' }))[0], 'ENCRYPTED');
});

test('JavaScript and attachments are reported, attachments only below part 3', async () => {
  const withScript = await PDFDocument.load(doc);
  withScript.addJavaScript('hello', 'app.alert("hi")');
  await withScript.attach(new Uint8Array([1, 2, 3]), 'data.bin', { mimeType: 'application/octet-stream' });
  const bytes = await withScript.save();
  assert.ok(codes(await checkPdfA(bytes)).includes('JAVASCRIPT'));
  assert.ok(codes(await checkPdfA(bytes, { part: 2 })).includes('ATTACHMENTS'));
  assert.ok(!codes(await checkPdfA(bytes, { part: 3 })).includes('ATTACHMENTS'));
  const fixed = await toPdfA(bytes);
  assert.ok(!codes(await checkPdfA(fixed, { part: 3 })).includes('JAVASCRIPT'), 'toPdfA removes document JavaScript');
});

test('toPdfA adds what PDF/A needs and the pages look the same', async () => {
  const titled = await setMetadata(doc, { title: 'Annual & <report>', author: 'A Writer' });
  const out = await toPdfA(titled, { part: 2 });
  const check = await checkPdfA(out);
  assert.deepEqual(check.claimed, { part: 2, conformance: 'B' });
  assert.deepEqual(codes(check), ['FONT_NOT_EMBEDDED'], 'fonts that are not embedded cannot be fixed here');
  const [a, b] = [await renderPage(titled, { dpi: 50, format: 'rgba' }), await renderPage(out, { dpi: 50, format: 'rgba' })];
  assert.deepEqual(a.data, b.data);
  const loaded = await PDFDocument.load(out, { updateMetadata: false });
  const meta = /** @type {import('@cantoo/pdf-lib').PDFRawStream} */ (loaded.catalog.lookup(PDFName.of('Metadata')));
  const xmp = new TextDecoder().decode(meta.getContents());
  assert.match(xmp, /<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Annual &amp; &lt;report&gt;<\/rdf:li><\/rdf:Alt><\/dc:title>/);
  assert.match(xmp, /<dc:creator><rdf:Seq><rdf:li>A Writer<\/rdf:li><\/rdf:Seq><\/dc:creator>/);
  assert.equal(meta.dict.get(PDFName.of('Filter')), undefined, 'the metadata stream is not compressed');
  assert.ok(loaded.context.trailerInfo.ID, 'a file identifier');
  assert.equal((await inspect(out)).metadata.title, 'Annual & <report>');
  for (const part of /** @type {const} */ ([1, 3])) assert.deepEqual((await checkPdfA(await toPdfA(doc, { part }))).claimed, { part, conformance: 'B' });
});

test('toPdfA refuses what it cannot fix', async () => {
  const locked = await encrypt(doc, { userPassword: 'pw' });
  await assert.rejects(toPdfA(locked), { code: 'UNSUPPORTED_SECURITY', message: /decrypt/ });
  await assert.rejects(toPdfA(doc, { part: /** @type {any} */ (4) }), { code: 'INVALID_OPTION' });
  await assert.rejects(checkPdfA(doc, { part: /** @type {any} */ (0) }), { code: 'INVALID_OPTION' });
});

test('the colour profile is a valid ICC version 2 display profile', () => {
  const icc = srgbProfile();
  const view = new DataView(icc.buffer);
  assert.equal(view.getUint32(0), icc.length, 'size in the header');
  assert.equal(String.fromCharCode(...icc.subarray(36, 40)), 'acsp');
  assert.equal(String.fromCharCode(...icc.subarray(12, 20)), 'mntrRGB ');
  assert.equal(view.getUint32(128), 9, 'nine tags');
  for (let i = 0; i < 9; i++) {
    const offset = view.getUint32(132 + i * 12 + 4);
    const size = view.getUint32(132 + i * 12 + 8);
    assert.ok(offset % 4 === 0 && offset + size <= icc.length, `tag ${i} inside the profile`);
  }
  assert.deepEqual(srgbProfile(), icc, 'the same every time');
});

test('XMP leaves out what the document does not have', () => {
  const xmp = xmpPacket(1, { title: '', author: '', subject: '', keywords: '', creator: '', producer: '' });
  assert.match(xmp, /<pdfaid:part>1<\/pdfaid:part><pdfaid:conformance>B<\/pdfaid:conformance><\/rdf:Description>/);
  assert.doesNotMatch(xmp, /dc:title|xmp:CreateDate/);
});
