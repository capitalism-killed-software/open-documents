import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { textDocument, formDocument } from '@open-documents/fixtures';
import { redact, verifyRedaction, extractText, extractWords, renderPage, inspect, getBookmarks, getFormFields, encrypt, overlay, toPdfA } from '../src/index.js';
import { rasterise } from '../src/redact.js';
import { encodePng } from '../src/png.js';
import { engine } from '../src/engine/pdfium.js';

/** A page with a card number, a name twice, a green picture and a small blue square. */
async function statement() {
  const doc = await PDFDocument.create();
  doc.setTitle('Statement for Sam Sample');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Card 4111 2222 3333 4444 belongs to Sam Sample.', { x: 72, y: 700, size: 12, font });
  page.drawText('Call Sam Sample on 555 0100.', { x: 72, y: 680, size: 12, font });
  const green = new Uint8Array(200 * 100 * 4);
  for (let i = 0; i < 200 * 100; i++) green.set([0, 160, 60, 255], i * 4);
  page.drawImage(await doc.embedPng(encodePng(green, 200, 100)), { x: 72, y: 540, width: 200, height: 100 });
  page.drawRectangle({ x: 320, y: 560, width: 40, height: 40, color: rgb(0, 0, 0.8) });
  page.drawLine({ start: { x: 72, y: 520 }, end: { x: 540, y: 520 }, thickness: 1 });
  return doc.save();
}

/** @param {Uint8Array} bytes @returns {Promise<import('../src/redact.js').RedactionReport>} */
async function reportOf(bytes, /** @type {any} */ options) {
  /** @type {any} */
  let report;
  const out = await redact(bytes, { ...options, onReport: (r) => (report = r) });
  return Object.assign(report, { out });
}

test('words, patterns and boxes are removed for good, the rest stays', async () => {
  const { out, ...report } = await reportOf(await statement(), {
    text: ['Sam Sample', /\d{4} \d{4} \d{4} \d{4}/],
    areas: [{ page: 1, x: 172, y: 150, width: 200, height: 110 }],
  });
  const [page] = await extractText(out);
  assert.equal(page.text, 'Card belongs to .\nCall on 555 0100.');
  assert.deepEqual(report.matches, [{ pattern: 'Sam Sample', page: 1, count: 2 }, { pattern: '/\\d{4} \\d{4} \\d{4} \\d{4}/', page: 1, count: 1 }]);
  assert.equal(report.boxes, 4);
  assert.deepEqual(report.verification, { ok: true, problems: [] });
  assert.deepEqual(report.rasterised, []);
  assert.equal((await inspect(out)).metadata.title, 'Statement for', 'the name is taken out of the title too');
  const shown = await renderPage(out, { dpi: 72, format: 'rgba' });
  const at = (/** @type {number} */ x, /** @type {number} */ y) => [...shown.data.subarray((y * shown.width + x) * 4, (y * shown.width + x) * 4 + 3)];
  assert.deepEqual(at(270, 200), [0, 0, 0], 'a solid box over the area');
  assert.deepEqual(at(100, 200), [0, 160, 60], 'the picture outside the area stays');
});

test('the picture under a box is changed in the file, not only covered', async () => {
  const { out } = await reportOf(await statement(), { areas: [{ page: 1, x: 172, y: 150, width: 200, height: 110 }] });
  const pdf = await engine();
  const { fn } = pdf;
  const pixels = pdf.withDocument(out, {}, (doc) => pdf.withPage(doc, 0, (page) => {
    for (let k = 0; k < fn.FPDFPage_CountObjects(page); k++) {
      const obj = fn.FPDFPage_GetObject(page, k);
      if (fn.FPDFPageObj_GetType(obj) !== 3) continue;
      const bitmap = fn.FPDFImageObj_GetBitmap(obj);
      try {
        const start = fn.FPDFBitmap_GetBuffer(bitmap);
        const stride = fn.FPDFBitmap_GetStride(bitmap);
        const step = fn.FPDFBitmap_GetFormat(bitmap) === 2 ? 3 : 4;
        const px = (/** @type {number} */ x, /** @type {number} */ y) => [...pdf.wasm.HEAPU8.subarray(start + y * stride + x * step, start + y * stride + x * step + 3)];
        return { kept: px(20, 50), gone: px(190, 50) };
      } finally {
        fn.FPDFBitmap_Destroy(bitmap);
      }
    }
    return null;
  }));
  assert.ok(pixels);
  assert.deepEqual(pixels.kept, [60, 160, 0], 'BGR: the green part outside the box');
  assert.notDeepEqual(pixels.gone, [60, 160, 0], 'the part under the box is gone from the image data');
});

test('drawings wholly under a box are removed; ones crossing it are counted', async () => {
  const report = await reportOf(await statement(), { areas: [{ page: 1, x: 300, y: 180, width: 100, height: 100 }] });
  assert.equal(report.drawingsCrossing.length, 1, 'the line runs under the box and out of it');
  const pdf = await engine();
  const paths = pdf.withDocument(report.out, {}, (doc) => pdf.withPage(doc, 0, (page) => {
    const kinds = [];
    for (let k = 0; k < pdf.fn.FPDFPage_CountObjects(page); k++) kinds.push(pdf.fn.FPDFPageObj_GetType(pdf.fn.FPDFPage_GetObject(page, k)));
    return kinds.filter((t) => t === 2).length;
  }));
  assert.equal(paths, 2, 'the line and the redaction box; the blue square is gone');
});

test('a form field under a box goes, and so does its value', async () => {
  const form = await formDocument();
  const [name] = await getFormFields(form.bytes);
  const [widget] = name.widgets;
  const { out, verification } = await reportOf(form.bytes, { areas: [{ page: 1, ...widget }], text: ['Sample Person'] });
  assert.ok(!(await getFormFields(out)).some((f) => f.name === 'name' && f.widgets.length));
  assert.deepEqual(verification.problems, []);
});

test('bookmarks and XMP metadata lose the matches too', async () => {
  const doc = await textDocument({ pages: 1, lines: () => ['Notes on Sam Sample'], bookmarks: [{ title: 'About Sam Sample', page: 1 }] });
  const archived = await toPdfA(doc.bytes);
  const { out, verification } = await reportOf(archived, { text: ['Sam Sample'] });
  assert.deepEqual(verification, { ok: true, problems: [] });
  assert.deepEqual((await getBookmarks(out)).map((b) => b.title), ['About']);
  const all = await reportOf(doc.bytes, { text: ['Notes'], metadata: true });
  assert.equal((await inspect(all.out)).metadata.title, '');
});

test('an area on a turned page is the area as it is shown', async () => {
  const doc = await textDocument({ pages: 1, rotation: 90, lines: () => ['Keep this', 'Remove this'] });
  const [page] = await extractWords(doc.bytes);
  const remove = /** @type {import('../src/text.js').Word} */ (page.words.find((w) => w.text === 'Remove'));
  const { out, verification } = await reportOf(doc.bytes, { areas: [{ page: 1, x: remove.x - 2, y: remove.y - 2, width: remove.width + 4, height: remove.height + 4 }] });
  assert.deepEqual(verification.problems, []);
  assert.equal((await extractText(out))[0].text, 'Keep this\nthis');
});

test('text inside a form object, such as an OCR layer, is found and removed', async () => {
  const blank = (await textDocument({ pages: 1, lines: () => [''] })).bytes;
  const layer = (await textDocument({ pages: 1, lines: () => ['Patient Sam Sample, ward 4'] })).bytes;
  const { out, verification } = await reportOf(await overlay(blank, layer), { text: ['Sam Sample'] });
  assert.equal((await extractText(out))[0].text, 'Patient , ward 4');
  assert.deepEqual(verification.problems, []);
});

test('an encrypted file is redacted and stays encrypted', async () => {
  const locked = await encrypt(await statement(), { userPassword: 'pw' });
  const { out, verification } = await reportOf(locked, { text: ['Sam Sample'], password: 'pw' });
  assert.equal((await inspect(out, { password: 'pw' })).encrypted, true);
  assert.doesNotMatch((await extractText(out, { password: 'pw' }))[0].text, /Sam/);
  assert.deepEqual(verification.problems.map((p) => p.code), [], JSON.stringify(verification.problems));
});

test('verifyRedaction catches a file that was only covered up', async () => {
  const doc = await statement();
  const result = await verifyRedaction(doc, { text: ['Sam Sample'], areas: [{ page: 1, x: 70, y: 80, width: 100, height: 20 }], color: '#000000' });
  assert.equal(result.ok, false);
  assert.deepEqual([...new Set(result.problems.map((p) => p.code))].sort(), ['BOX_MISSING', 'IN_FILE', 'IN_METADATA', 'TEXT_STILL_THERE', 'TEXT_UNDER_BOX']);
  const updated = new Uint8Array([...doc, ...new TextEncoder().encode('\n%%EOF\n')]);
  assert.ok((await verifyRedaction(updated)).problems.some((p) => p.code === 'OLD_REVISIONS'));
  const { out } = await reportOf(updated, { text: ['555'] });
  assert.ok(!(await verifyRedaction(out)).problems.some((p) => p.code === 'OLD_REVISIONS'), 'redact writes the file whole');
});

test('the fallback: a page replaced by a picture of itself keeps its look and loses its text', async () => {
  const doc = (await textDocument({ pages: 2, rotation: [90, 0] })).bytes;
  const flat = await rasterise(doc, [1], undefined);
  const [one, two] = await extractText(flat);
  assert.equal(one.text, '');
  assert.match(two.text, /quick brown fox/);
  const [before, after] = [(await inspect(doc)).pages[0], (await inspect(flat)).pages[0]];
  assert.deepEqual([after.width, after.height, after.rotation], [before.width, before.height, 90]);
  const [a, b] = [await renderPage(doc, { dpi: 30, format: 'rgba' }), await renderPage(flat, { dpi: 30, format: 'rgba' })];
  let differ = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 60) differ++;
  assert.ok(differ / (a.width * a.height) < 0.01, 'looks the same');
});

test('bad requests are refused', async () => {
  const doc = await statement();
  await assert.rejects(redact(doc), { code: 'INVALID_OPTION', message: /areas or text/ });
  await assert.rejects(redact(doc, { areas: [{ page: 0, x: 1, y: 1, width: 1, height: 1 }] }), { code: 'INVALID_OPTION' });
  await assert.rejects(redact(doc, { areas: [{ page: 2, x: 1, y: 1, width: 1, height: 1 }] }), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(redact(doc, { text: [''] }), { code: 'INVALID_OPTION' });
  await assert.rejects(redact(doc, { text: /** @type {any} */ ('Sam') }), { code: 'INVALID_OPTION' });
  await assert.rejects(redact(doc, { text: ['Sam'], color: 'black' }), { code: 'INVALID_OPTION' });
});
