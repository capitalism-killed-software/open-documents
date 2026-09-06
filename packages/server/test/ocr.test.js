import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { textDocument } from '@open-documents/fixtures';
import { renderPages, imagesToPdf, extractText } from '@open-documents/core';
import { buildServer } from '../src/index.js';
import { form } from './helpers.js';

const doc = await textDocument({ pages: 1 });
const scan = await imagesToPdf((await renderPages(doc.bytes, { dpi: 200 })).map((p) => p.data), { pageSize: 'fit', dpi: 200 });
const app = await buildServer({ ocrWorkers: 1 });
after(() => app.close());

/**
 * @param {string} operation
 * @param {Uint8Array[]} files
 * @param {object} [options]
 */
async function post(operation, files, options) {
  const body = await form(files.map((data, i) => ({ filename: `${i}.pdf`, data })), options);
  return app.inject({ method: 'POST', url: `/v1/pdf/${operation}`, ...body });
}

test('ocr makes a scan searchable', async () => {
  const res = await post('ocr', [scan]);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['content-type'], 'application/pdf');
  const [page] = await extractText(new Uint8Array(res.rawPayload));
  assert.match(page.text, /quick brown fox/);
});

test('recognize answers with the words and where they are', async () => {
  const res = await post('recognize', [scan], { dpi: 150 });
  assert.equal(res.statusCode, 200, res.body);
  const [page] = res.json();
  assert.match(page.text, /quick brown fox/);
  assert.ok(page.words.some((/** @type {any} */ w) => w.text === 'fox' && w.confidence > 50));
});

test('only the languages the server was started with', async () => {
  const fine = await post('recognize', [scan], { languages: ['eng'], pages: [1] });
  assert.equal(fine.statusCode, 200);
  const other = await post('ocr', [scan], { languages: ['deu'] });
  assert.deepEqual([other.statusCode, other.json().error.code], [400, 'INVALID_OPTION']);
  assert.match(other.json().error.message, /OPENDOCS_OCR_LANGUAGES/);
  const bad = await post('ocr', [scan], { languages: 'eng' });
  assert.equal(bad.statusCode, 400);
});

test('an engine handed in is used, and left open for its owner', async () => {
  /** @type {string[]} */
  const calls = [];
  const engine = {
    ocr: async (/** @type {Uint8Array} */ b, /** @type {any} */ o) => { calls.push(`ocr ${JSON.stringify(o)}`); return b; },
    recognize: async () => { calls.push('recognize'); return []; },
    close: async () => { calls.push('close'); },
  };
  const own = await buildServer({ ocr: engine });
  try {
    const body = await form([{ filename: 'a.pdf', data: scan }], { force: true, dpi: 200, onPage: 'ignored', workers: 9 });
    assert.equal((await own.inject({ method: 'POST', url: '/v1/pdf/ocr', ...body })).statusCode, 200);
    const words = await form([{ filename: 'a.pdf', data: scan }], { force: true });
    assert.deepEqual((await own.inject({ method: 'POST', url: '/v1/pdf/recognize', ...words })).json(), []);
  } finally {
    await own.close();
  }
  assert.deepEqual(calls, ['ocr {"dpi":200,"force":true}', 'recognize']);
});

test('an engine that cannot start is tried again on the next request', async () => {
  const broken = await buildServer({ ocrLangPath: '/nowhere' });
  try {
    for (let i = 0; i < 2; i++) {
      const res = await broken.inject({ method: 'POST', url: '/v1/pdf/ocr', ...(await form([{ filename: 'a.pdf', data: scan }])) });
      assert.deepEqual([res.statusCode, res.json().error.code], [501, 'ENGINE_MISSING']);
    }
  } finally {
    await broken.close();
  }
});

test('overlay takes the document, then the layer', async () => {
  const layer = await PDFDocument.create();
  const font = await layer.embedFont(StandardFonts.Helvetica);
  layer.addPage([612, 792]).drawText('LETTERHEAD', { x: 40, y: 760, size: 12, font });
  const res = await post('overlay', [doc.bytes, await layer.save()], { fit: 'stretch' });
  assert.equal(res.statusCode, 200, res.body);
  const [page] = await extractText(new Uint8Array(res.rawPayload));
  assert.match(page.text, /LETTERHEAD/);
  const one = await post('overlay', [doc.bytes]);
  assert.deepEqual([one.statusCode, one.json().error.code], [400, 'INVALID_INPUT']);
});

test('to-docx and to-pptx answer with office files', async () => {
  const word = await post('to-docx', [doc.bytes]);
  assert.equal(word.statusCode, 200, word.body);
  assert.equal(word.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual([...word.rawPayload.subarray(0, 2)], [0x50, 0x4b], 'a zip');
  const slides = await post('to-pptx', [doc.bytes], { background: false });
  assert.equal(slides.headers['content-type'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});

test('forms over http: read, fill, add and flatten', async () => {
  const { formDocument } = await import('@open-documents/fixtures');
  const { bytes } = await formDocument();
  const fields = await post('form-fields', [bytes]);
  assert.deepEqual(fields.json().map((/** @type {any} */ f) => f.name), ['name', 'agree', 'colour', 'notes']);
  const filled = await post('fill-form', [bytes], { values: { name: 'Over HTTP' }, flatten: true });
  assert.match((await extractText(new Uint8Array(filled.rawPayload)))[0].text, /Over HTTP/);
  const added = await post('add-form-fields', [doc.bytes], { fields: [{ type: 'text', name: 'x', page: 1, x: 10, y: 10, width: 50, height: 20 }] });
  assert.equal(added.statusCode, 200, added.body);
  const flat = await post('flatten', [bytes]);
  assert.equal(flat.statusCode, 200);
  const bad = await post('fill-form', [bytes], { values: { missing: 'x' } });
  assert.deepEqual([bad.statusCode, bad.json().error.code], [400, 'INVALID_OPTION']);
});

test('compare two versions over http', async () => {
  const { textDocument } = await import('@open-documents/fixtures');
  const a = (await textDocument({ pages: 1, lines: () => ['Pay 1200 now.'] })).bytes;
  const b = (await textDocument({ pages: 1, lines: () => ['Pay 1350 now.'] })).bytes;
  const text = await post('compare-text', [a, b]);
  assert.deepEqual(text.json().changes.map((/** @type {any} */ c) => [c.before, c.after]), [['1200', '1350']]);
  const visual = await post('compare-visual', [a, b], { images: true, dpi: 36 });
  assert.match(visual.json()[0].png, /^iVBOR/);
  const report = await post('compare-report', [a, b]);
  assert.equal(report.headers['content-type'], 'application/pdf');
  const one = await post('compare-text', [a]);
  assert.deepEqual([one.statusCode, one.json().error.code], [400, 'INVALID_INPUT']);
});

test('pdf/a over http: check, fix, and convert straight to it', async () => {
  const check = await post('check-pdfa', [doc.bytes]);
  assert.deepEqual(check.json().problems.map((/** @type {any} */ p) => p.code), ['FONT_NOT_EMBEDDED', 'NO_PDFA_ID', 'NO_OUTPUT_INTENT']);
  const fixed = await post('to-pdfa', [doc.bytes], { part: 3 });
  assert.equal(fixed.statusCode, 200);
  const { pngImage } = await import('@open-documents/fixtures');
  const body = await form([{ filename: 'p.png', data: pngImage() }], { pdfa: 2 });
  const converted = await app.inject({ method: 'POST', url: '/v1/convert', ...body });
  assert.equal(converted.statusCode, 200, converted.body);
  const again = await post('check-pdfa', [new Uint8Array(converted.rawPayload)]);
  assert.deepEqual(again.json(), { claimed: { part: 2, conformance: 'B' }, problems: [] });
});

test('redaction over http takes words, not patterns', async () => {
  const { textDocument } = await import('@open-documents/fixtures');
  const doc = (await textDocument({ pages: 1, lines: () => ['Ring Sam Sample now'] })).bytes;
  const res = await post('redact', [doc], { text: ['Sam Sample'] });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await extractText(new Uint8Array(res.rawPayload)))[0].text, 'Ring now');
  const checked = await post('verify-redaction', [new Uint8Array(res.rawPayload)], { text: ['Sam Sample'] });
  assert.deepEqual(checked.json(), { ok: true, problems: [] });
  const regex = await post('redact', [doc], { text: [{ source: '.*' }] });
  assert.deepEqual([regex.statusCode, regex.json().error.code], [400, 'INVALID_OPTION']);
});
