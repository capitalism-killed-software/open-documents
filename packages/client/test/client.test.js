// Against a real server on this machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument, pngImage } from '@open-documents/fixtures';
import { inspect, extractText } from '@open-documents/core';
import { buildServer } from '@open-documents/server';
import { createClient, OpenDocumentsError } from '../src/index.js';

const KEY = 'client-test-key-0123456789';
/** @type {Awaited<ReturnType<typeof buildServer>>} */
let server;
/** @type {ReturnType<typeof createClient>} */
let client;
let baseUrl = '';
const doc = await textDocument({ pages: 3, lines: (n) => [`Page ${n}`] });

before(async () => {
  server = await buildServer({ apiKeys: [KEY] });
  baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
  client = createClient({ baseUrl: `${baseUrl}/`, apiKey: KEY });
});
after(() => server.close());

test('the same names as core, over http', async () => {
  assert.equal((await client.inspect(doc.bytes)).pageCount, 3);
  const turned = await client.rotate(doc.bytes, { angle: 90 });
  assert.equal((await inspect(turned)).pages[0].rotation, 90);
  assert.deepEqual(await client.extractText(doc.bytes, { pages: [2] }), [{ page: 2, text: 'Page 2' }]);
  const two = await client.extractPages(doc.bytes, '2-3');
  assert.deepEqual((await extractText(two)).map((p) => p.text), ['Page 2', 'Page 3']);
  const reordered = await client.reorder(doc.bytes, [3, 2, 1]);
  assert.equal((await extractText(reordered))[0].text, 'Page 3');
  assert.equal((await inspect(await client.removePages(new Blob([doc.bytes]), [1]))).pageCount, 2);
});

test('several files in, several files out', async () => {
  const merged = await client.merge([doc.bytes, doc.bytes.buffer.slice(0)], { bookmarks: true });
  assert.equal((await inspect(merged)).pageCount, 6);
  const parts = await client.split(doc.bytes);
  assert.equal(parts.length, 3);
  assert.equal((await extractText(parts[1]))[0].text, 'Page 2');
  const thumbs = await client.thumbnails(doc.bytes, { width: 40 });
  assert.equal(thumbs.length, 3);
  const pdf = await client.imagesToPdf([pngImage(), pngImage()]);
  assert.equal((await inspect(pdf)).pageCount, 2);
  const withMarks = await client.setBookmarks(doc.bytes, [{ title: 'Start', page: 1 }]);
  assert.deepEqual(await client.getBookmarks(withMarks), [{ title: 'Start', page: 1, children: [] }]);
});

test('jobs: submit, then wait for the result', async () => {
  const job = await client.submit('watermark', doc.bytes, { text: 'DRAFT' });
  assert.equal(job.status === 'queued' || job.status === 'running' || job.status === 'done', true);
  const result = await client.wait(job, { interval: 20 });
  assert.match((await extractText(result))[0].text, /DRAFT/);
  const converted = await client.wait(await client.submit('convert', pngImage()), { interval: 20 });
  assert.equal((await inspect(converted)).pageCount, 1);
});

test('server errors become OpenDocumentsError with the same code', async () => {
  await assert.rejects(client.rotate(doc.bytes, { angle: 45 }), (err) => {
    assert.ok(err instanceof OpenDocumentsError);
    assert.deepEqual([err.code, err.status], ['INVALID_OPTION', 400]);
    return true;
  });
  const failing = await client.submit('rotate', doc.bytes, { angle: 45 });
  await assert.rejects(client.wait(failing, { interval: 20 }), { code: 'INVALID_OPTION' });
  const anonymous = createClient({ baseUrl });
  await assert.rejects(anonymous.inspect(doc.bytes), { code: 'UNAUTHORIZED', status: 401 });
  await assert.rejects(client.urlToPdf('https://example.com'), { code: 'URL_DISABLED' });
  await assert.rejects(client.run('fold', doc.bytes), { code: 'INVALID_OPTION' });
});

test('non-json failures and a missing base url', async () => {
  const broken = createClient({ baseUrl: 'http://x', fetch: async () => new Response('gateway down', { status: 502 }) });
  await assert.rejects(broken.inspect(doc.bytes), { code: 'HTTP_ERROR', status: 502, message: /502/ });
  assert.throws(() => createClient(/** @type {any} */ ({})), TypeError);
  const slow = createClient({ baseUrl: 'http://x', fetch: async () => Response.json({ id: 'j', status: 'running', links: { self: '/v1/jobs/j', result: '/v1/jobs/j/result' } }) });
  await assert.rejects(slow.wait({ id: 'j', status: 'running', error: null, links: { self: '/v1/jobs/j', result: '/r' } }, { interval: 5, timeout: 20 }), { code: 'TIMEOUT' });
});

test('compress over http', async (t) => {
  const { findQpdf } = await import('@open-documents/node');
  if (!(await findQpdf())) return t.skip('qpdf is not installed');
  const big = await textDocument({ pages: 40 });
  const small = await client.compress(big.bytes);
  assert.ok(small.length < big.bytes.length);
  assert.equal((await inspect(await client.repair(big.bytes))).pageCount, 40);
  assert.match(new TextDecoder('latin1').decode((await client.linearize(doc.bytes)).subarray(0, 1024)), /\/Linearized/);
});

test('overlay, ocr and recognize', async () => {
  const { renderPages, imagesToPdf } = await import('@open-documents/core');
  const scan = await imagesToPdf((await renderPages(doc.bytes, { pages: [1], dpi: 200 })).map((p) => p.data), { pageSize: 'fit', dpi: 200 });
  const searchable = await client.ocr(scan);
  assert.match((await extractText(searchable))[0].text, /Page 1/);
  const [page] = await client.recognize(scan, { dpi: 150 });
  assert.ok(page.words.some((/** @type {{ text: string }} */ w) => w.text === 'Page'));
  const layered = await client.overlay(doc.bytes, scan, { pages: [2], behind: true });
  assert.equal((await inspect(layered)).pageCount, 3);
});

test('toDocx and toPptx come back as office files', async () => {
  const { unzipSync } = await import('fflate');
  const word = unzipSync(await client.toDocx(doc.bytes, { pages: [1] }));
  assert.ok(word['word/document.xml']);
  const slides = unzipSync(await client.toPptx(doc.bytes));
  assert.ok(slides['ppt/slides/slide3.xml']);
});

test('markdown, html, json and excel from the server', { skip: await doclingMissing() }, async () => {
  const { reportDocument } = await import('@open-documents/fixtures');
  const { bytes } = await reportDocument();
  assert.match(await client.pdfToMarkdown(bytes, { pages: [1] }), /\| West\s+\|\s+1430/);
  assert.match(await client.pdfToHtml(bytes), /<table>/);
  assert.equal((await client.pdfToJson(bytes)).tables.length, 1);
  const xlsx = await client.pdfToXlsx(bytes);
  assert.deepEqual([...xlsx.subarray(0, 2)], [0x50, 0x4b]);
});

/** Why the Docling tests cannot run here, or false when they can. */
async function doclingMissing() {
  const { findPython, doclingModels } = await import('@open-documents/node');
  const { existsSync } = await import('node:fs');
  return findPython() && existsSync(doclingModels()) ? false : 'Docling is not set up';
}

test('forms from the client', async () => {
  const { formDocument } = await import('@open-documents/fixtures');
  const { bytes } = await formDocument();
  const filled = await client.fillForm(bytes, { colour: 'red', agree: false });
  const fields = await client.getFormFields(filled);
  assert.deepEqual(fields.map((/** @type {any} */ f) => f.value), ['Sample Person', false, 'red', '']);
  const added = await client.addFormFields(doc.bytes, [{ type: 'checkbox', name: 'ok', page: 2, x: 20, y: 20, width: 12, height: 12, value: true }]);
  assert.equal((await client.getFormFields(added))[0].value, true);
  assert.equal((await inspect(await client.flatten(filled))).forms, 'none');
});

test('compare from the client', async () => {
  const a = (await textDocument({ pages: 1, lines: () => ['Pay 1200 now.'] })).bytes;
  const b = (await textDocument({ pages: 1, lines: () => ['Pay 1350 now.'] })).bytes;
  assert.equal((await client.compareText(a, b)).changes[0].after, '1350');
  assert.ok((await client.compareVisual(a, b))[0].changed > 0);
  assert.equal((await inspect(await client.compareReport(a, b))).pageCount, 1);
});

test('compressImages over the server', async () => {
  const { renderPages, imagesToPdf } = await import('@open-documents/core');
  const scan = await imagesToPdf((await renderPages(doc.bytes, { pages: [1], dpi: 300 })).map((p) => p.data), { pageSize: 'fit', dpi: 300 });
  assert.ok((await client.compressImages(scan, { dpi: 100 })).length < scan.length);
});
