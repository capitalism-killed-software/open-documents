import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { textDocument, pngImage } from '@open-documents/fixtures';
import { inspect, extractText } from '@open-documents/core';
import { buildServer } from '../src/index.js';
import { form } from './helpers.js';

/** @type {Awaited<ReturnType<typeof buildServer>>} */
let app;
const doc = await textDocument({ pages: 3, lines: (n) => [`Page ${n}`] });
const file = (/** @type {Uint8Array} */ data = doc.bytes, filename = 'doc.pdf') => ({ filename, data, type: 'application/pdf' });

before(async () => {
  app = await buildServer();
});
after(() => app.close());

/**
 * @param {string} url
 * @param {Awaited<ReturnType<typeof form>>} body
 * @param {Record<string, string>} [headers]
 */
const post = (url, body, headers = {}) => app.inject({ method: 'POST', url, payload: body.payload, headers: { ...body.headers, ...headers } });

test('health and the list of operations', async () => {
  assert.deepEqual((await app.inject('/health')).json(), { ok: true });
  const ops = (await app.inject('/v1/operations')).json();
  assert.ok(ops.pdf.includes('merge') && ops.pdf.includes('watermark'));
  assert.deepEqual(ops.convert, ['file', 'html', 'markdown']);
});

test('an operation that returns a pdf', async () => {
  const res = await post('/v1/pdf/rotate', await form([file()], { angle: 90, pages: '2' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.deepEqual((await inspect(res.rawPayload)).pages.map((p) => p.rotation), [0, 90, 0]);
});

test('operations that return json', async () => {
  const info = await post('/v1/pdf/inspect', await form([file()]));
  assert.equal(info.json().pageCount, 3);
  const text = await post('/v1/pdf/text', await form([file()], { pages: [2] }));
  assert.deepEqual(text.json(), [{ page: 2, text: 'Page 2' }]);
});

test('merge takes several files; split returns a zip', async () => {
  const merged = await post('/v1/pdf/merge', await form([file(), file()], { bookmarks: true, items: [{ pages: '1' }, {}] }));
  assert.equal((await inspect(merged.rawPayload)).pageCount, 4);
  const parts = await post('/v1/pdf/split', await form([file()]));
  assert.equal(parts.headers['content-type'], 'application/zip');
  const files = unzipSync(new Uint8Array(parts.rawPayload));
  assert.deepEqual(Object.keys(files), ['part-1.pdf', 'part-2.pdf', 'part-3.pdf']);
  assert.equal((await extractText(files['part-3.pdf']))[0].text, 'Page 3');
});

test('render gives a png for one page and a zip for several', async () => {
  const one = await post('/v1/pdf/render', await form([file()], { pages: [1], dpi: 18 }));
  assert.equal(one.headers['content-type'], 'image/png');
  const many = await post('/v1/pdf/thumbnails', await form([file()], { width: 50 }));
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(many.rawPayload))), ['page-1.png', 'page-2.png', 'page-3.png']);
});

test('images become a pdf, and images convert one at a time', async () => {
  const res = await post('/v1/pdf/images-to-pdf', await form([{ filename: 'a.png', data: pngImage() }, { filename: 'b.png', data: pngImage() }], { pageSize: 'fit' }));
  assert.equal((await inspect(res.rawPayload)).pageCount, 2);
  const one = await post('/v1/convert', await form([{ filename: 'scan.png', data: pngImage() }]));
  assert.equal(one.statusCode, 200);
  assert.equal((await inspect(one.rawPayload)).pageCount, 1);
});

test('errors are json with a stable code and a fitting status', async () => {
  const unknown = await post('/v1/pdf/fold', await form([file()]));
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error.code, 'INVALID_OPTION');
  const notPdf = await post('/v1/pdf/inspect', await form([file(new TextEncoder().encode('hello'), 'x.pdf')]));
  assert.deepEqual([notPdf.statusCode, notPdf.json().error.code], [400, 'INVALID_INPUT']);
  const locked = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  const needsPassword = await post('/v1/pdf/inspect', await form([file(locked.bytes)]));
  assert.deepEqual([needsPassword.statusCode, needsPassword.json().error.code], [422, 'PASSWORD_REQUIRED']);
  const badPage = await post('/v1/pdf/rotate', await form([file()], { angle: 90, pages: [9] }));
  assert.equal(badPage.json().error.code, 'PAGE_NOT_FOUND');
  const twoFiles = await post('/v1/pdf/rotate', await form([file(), file()], { angle: 90 }));
  assert.match(twoFiles.json().error.message, /takes one file/);
  const none = await post('/v1/pdf/rotate', await form([], { angle: 90 }));
  assert.equal(none.json().error.code, 'INVALID_INPUT');
  const notForm = await app.inject({ method: 'POST', url: '/v1/pdf/rotate', payload: { angle: 90 } });
  assert.match(notForm.json().error.message, /multipart/);
});

test('options must be a json object', async () => {
  const raw = new FormData();
  raw.append('file', new Blob([doc.bytes]), 'doc.pdf');
  raw.append('options', '{not json');
  const request = new Request('http://localhost/', { method: 'POST', body: raw });
  const res = await app.inject({ method: 'POST', url: '/v1/pdf/rotate', payload: Buffer.from(await request.arrayBuffer()), headers: { 'content-type': /** @type {string} */ (request.headers.get('content-type')) } });
  assert.match(res.json().error.message, /must be JSON/);
  const list = await post('/v1/pdf/rotate', await form([file()], [1, 2]));
  assert.match(list.json().error.message, /JSON object/);
});

test('url conversion is off unless the server turns it on', async () => {
  const res = await app.inject({ method: 'POST', url: '/v1/convert/url', payload: { url: 'https://example.com' } });
  assert.deepEqual([res.statusCode, res.json().error.code], [403, 'URL_DISABLED']);
});

test('json endpoints explain what they need', async () => {
  const html = await app.inject({ method: 'POST', url: '/v1/convert/html', payload: {} });
  assert.match(html.json().error.message, /"html"/);
  const md = await app.inject({ method: 'POST', url: '/v1/convert/markdown', payload: { markdown: 5 } });
  assert.match(md.json().error.message, /"markdown"/);
  const multi = await post('/v1/convert/html', await form([{ filename: 'page.html', data: new TextEncoder().encode('<p>x</p>') }]));
  assert.match(multi.json().error.message, /index\.html/);
  const convertNone = await post('/v1/convert', await form([]));
  assert.match(convertNone.json().error.message, /one file/);
});

test('compress, linearize and repair, when qpdf is installed', async (t) => {
  const { findQpdf } = await import('@open-documents/node');
  if (!(await findQpdf())) return t.skip('qpdf is not installed');
  const big = await textDocument({ pages: 40 });
  const small = await post('/v1/pdf/compress', await form([file(big.bytes)]));
  assert.equal(small.statusCode, 200);
  assert.ok(small.rawPayload.length < big.bytes.length);
  const fast = await post('/v1/pdf/linearize', await form([file()]));
  assert.match(fast.rawPayload.subarray(0, 1024).toString('latin1'), /\/Linearized/);
  const bad = await post('/v1/pdf/repair', await form([file(new TextEncoder().encode('not a pdf'), 'bad.pdf')]));
  assert.deepEqual([bad.statusCode, bad.json().error.code], [422, 'DAMAGED_FILE']);
});
