import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { buildServer } from '../src/index.js';
import { form } from './helpers.js';

const doc = await textDocument({ pages: 1 });

test('api keys: none, wrong and right', async () => {
  const app = await buildServer({ apiKeys: ['k-123'] });
  try {
    const body = await form([{ filename: 'a.pdf', data: doc.bytes }]);
    const none = await app.inject({ method: 'POST', url: '/v1/pdf/inspect', payload: body.payload, headers: body.headers });
    assert.equal(none.statusCode, 401);
    assert.equal(none.headers['www-authenticate'], 'Bearer');
    const wrong = await app.inject({ method: 'POST', url: '/v1/pdf/inspect', payload: body.payload, headers: { ...body.headers, authorization: 'Bearer nope' } });
    assert.equal(wrong.json().error.code, 'UNAUTHORIZED');
    const right = await app.inject({ method: 'POST', url: '/v1/pdf/inspect', payload: body.payload, headers: { ...body.headers, authorization: 'Bearer k-123' } });
    assert.equal(right.statusCode, 200);
    assert.equal((await app.inject('/health')).statusCode, 200, 'health needs no key');
  } finally {
    await app.close();
  }
});

test('files over the size limit are refused', async () => {
  const app = await buildServer({ maxFileSize: 1000 });
  try {
    const res = await app.inject({ method: 'POST', url: '/v1/pdf/inspect', ...(await form([{ filename: 'a.pdf', data: doc.bytes }])) });
    assert.deepEqual([res.statusCode, res.json().error.code], [413, 'TOO_LARGE']);
  } finally {
    await app.close();
  }
});

test('too many files are refused', async () => {
  const app = await buildServer({ maxFiles: 2 });
  try {
    const files = [1, 2, 3].map((n) => ({ filename: `${n}.pdf`, data: doc.bytes }));
    const res = await app.inject({ method: 'POST', url: '/v1/pdf/merge', ...(await form(files)) });
    assert.deepEqual([res.statusCode, res.json().error.code], [413, 'TOO_MANY_FILES']);
  } finally {
    await app.close();
  }
});

test('unexpected failures do not leak details', async () => {
  const broken = /** @type {any} */ ({ toPdf: async () => { throw new Error('secret internal detail'); }, close: async () => {} });
  const app = await buildServer({ converter: broken });
  try {
    const res = await app.inject({ method: 'POST', url: '/v1/convert', ...(await form([{ filename: 'a.pdf', data: doc.bytes }])) });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  } finally {
    await app.close();
  }
});

test('callers cannot widen what web pages may reach', async () => {
  /** @type {any[]} */
  const seen = [];
  const spy = /** @type {any} */ ({
    urlToPdf: async (/** @type {string} */ _url, /** @type {any} */ opts) => { seen.push(opts); return doc.bytes; },
    toPdf: async (/** @type {Uint8Array} */ b, /** @type {any} */ opts) => { seen.push(opts); return b; },
    close: async () => {},
  });
  const app = await buildServer({ converter: spy, allowUrl: true, allowHosts: ['intranet.local'] });
  try {
    const res = await app.inject({ method: 'POST', url: '/v1/convert/url', payload: { url: 'https://example.com', options: { allowHosts: ['169.254.169.254'], ports: [22], format: 'a4' } } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen[0], { format: 'a4', allowHosts: ['intranet.local'] });
    await app.inject({ method: 'POST', url: '/v1/convert', ...(await form([{ filename: 'a.pdf', data: doc.bytes }], { allowHosts: ['x'] })) });
    assert.equal(seen[1].allowHosts, undefined);
    assert.ok((await app.inject('/v1/operations')).json().convert.includes('url'));
  } finally {
    await app.close();
  }
});

test('compress, linearize and repair go to the converter', async () => {
  /** @type {string[]} */
  const calls = [];
  const spy = /** @type {any} */ ({
    compress: async (/** @type {Uint8Array} */ b) => { calls.push('compress'); return b; },
    linearize: async (/** @type {Uint8Array} */ b) => { calls.push('linearize'); return b; },
    repair: async (/** @type {Uint8Array} */ b) => { calls.push('repair'); return b; },
    close: async () => {},
  });
  const app = await buildServer({ converter: spy });
  try {
    for (const op of ['compress', 'linearize', 'repair']) {
      const res = await app.inject({ method: 'POST', url: `/v1/pdf/${op}`, ...(await form([{ filename: 'a.pdf', data: doc.bytes }])) });
      assert.equal(res.statusCode, 200, op);
    }
    assert.deepEqual(calls, ['compress', 'linearize', 'repair']);
  } finally {
    await app.close();
  }
});

test('to-markdown, to-html, to-json and to-xlsx go to the converter, with only their options', async () => {
  /** @type {string[]} */
  const calls = [];
  const spy = /** @type {any} */ ({
    pdfToMarkdown: async (/** @type {Uint8Array} */ _b, /** @type {any} */ o) => { calls.push(`md ${JSON.stringify(o)}`); return '# Title'; },
    pdfToHtml: async () => { calls.push('html'); return '<h1>Title</h1>'; },
    pdfToJson: async () => { calls.push('json'); return { texts: [] }; },
    pdfToXlsx: async () => { calls.push('xlsx'); return new Uint8Array([0x50, 0x4b]); },
    close: async () => {},
  });
  const app = await buildServer({ converter: spy });
  try {
    /** @param {string} op @param {object} [options] */
    const post = async (op, options) => app.inject({ method: 'POST', url: `/v1/pdf/${op}`, ...(await form([{ filename: 'a.pdf', data: doc.bytes }], options)) });
    const md = await post('to-markdown', { pages: [1], timeout: 1, python: '/bin/sh' });
    assert.deepEqual([md.statusCode, md.headers['content-type'], md.body], [200, 'text/markdown; charset=utf-8', '# Title']);
    assert.equal((await post('to-html')).headers['content-type'], 'text/html; charset=utf-8');
    assert.deepEqual((await post('to-json')).json(), { texts: [] });
    const xlsx = await post('to-xlsx');
    assert.equal(xlsx.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.deepEqual(calls, ['md {"pages":[1]}', 'html', 'json', 'xlsx']);
  } finally {
    await app.close();
  }
});
