import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { textDocument } from '@open-documents/fixtures';
import { inspect } from '@open-documents/core';
import { buildServer } from '../src/index.js';
import { sign } from '../src/webhooks.js';
import { form } from './helpers.js';

const doc = await textDocument({ pages: 2 });
const file = { filename: 'doc.pdf', data: doc.bytes };

/** @param {Awaited<ReturnType<typeof buildServer>>} app @param {string} url @param {Record<string, string>} [headers] */
async function until(app, url, headers = {}) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ url, headers });
    if (!['queued', 'running'].includes(res.json().status)) return res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('job did not finish');
}

test('respond-async: a 202 with a job, then the result', async () => {
  const app = await buildServer();
  try {
    const body = await form([file], { angle: 90 });
    const res = await app.inject({ method: 'POST', url: '/v1/pdf/rotate', payload: body.payload, headers: { ...body.headers, prefer: 'respond-async' } });
    assert.equal(res.statusCode, 202);
    const job = res.json();
    assert.match(job.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.headers.location, `/v1/jobs/${job.id}`);
    assert.deepEqual(job.links, { self: `/v1/jobs/${job.id}`, result: `/v1/jobs/${job.id}/result` });
    const done = await until(app, job.links.self);
    assert.equal(done.status, 'done');
    assert.ok(done.finished);
    const result = await app.inject({ url: job.links.result });
    assert.equal(result.headers['content-type'], 'application/pdf');
    assert.deepEqual((await inspect(result.rawPayload)).pages.map((p) => p.rotation), [90, 90]);
  } finally {
    await app.close();
  }
});

test('a failed job reports its error; an unfinished one says so', async () => {
  let release = () => {};
  const gate = new Promise((resolve) => (release = () => resolve(undefined)));
  const slow = /** @type {any} */ ({ toPdf: async (/** @type {Uint8Array} */ b) => { await gate; return b; }, close: async () => {} });
  const app = await buildServer({ converter: slow });
  try {
    const body = await form([file], { angle: 45 });
    const bad = (await app.inject({ method: 'POST', url: '/v1/pdf/rotate', payload: body.payload, headers: { ...body.headers, prefer: 'respond-async' } })).json();
    const failed = await until(app, bad.links.self);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'INVALID_OPTION');
    const result = await app.inject({ url: bad.links.result });
    assert.deepEqual([result.statusCode, result.json().error.code], [400, 'INVALID_OPTION']);

    const conv = await form([file]);
    const waiting = (await app.inject({ method: 'POST', url: '/v1/convert', payload: conv.payload, headers: { ...conv.headers, prefer: 'respond-async' } })).json();
    const early = await app.inject({ url: waiting.links.result });
    assert.deepEqual([early.statusCode, early.json().error.code, early.headers['retry-after']], [409, 'NOT_READY', '1']);
    release();
    assert.equal((await until(app, waiting.links.self)).status, 'done');
    assert.equal((await app.inject('/v1/jobs/00000000-0000-0000-0000-000000000000')).statusCode, 404);
    assert.equal((await app.inject('/v1/jobs/nope/result')).statusCode, 404);
  } finally {
    await app.close();
  }
});

test('a job can only be read with the key that made it', async () => {
  const app = await buildServer({ apiKeys: ['first-key-1234567', 'second-key-123456'] });
  try {
    const body = await form([file], { angle: 90 });
    const job = (await app.inject({ method: 'POST', url: '/v1/pdf/rotate', payload: body.payload, headers: { ...body.headers, prefer: 'respond-async', authorization: 'Bearer first-key-1234567' } })).json();
    assert.equal((await until(app, job.links.self, { authorization: 'Bearer first-key-1234567' })).status, 'done');
    const other = await app.inject({ url: job.links.result, headers: { authorization: 'Bearer second-key-123456' } });
    assert.equal(other.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('webhooks are signed, and retried until they get through', async () => {
  /** @type {{ body: string, signature: string }[]} */
  const calls = [];
  let fails = 1;
  const receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ body, signature: String(req.headers['opendocs-signature']) });
      res.writeHead(fails-- > 0 ? 500 : 204).end();
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (receiver.address()).port;
  const secret = 'whsec-test-0123456789';
  const app = await buildServer({ webhookSecret: secret, allowHosts: ['127.0.0.1'], webhookDelays: [10, 10] });
  try {
    const body = await form([file], { angle: 90, webhook: `http://127.0.0.1:${port}/hooks` });
    const res = await app.inject({ method: 'POST', url: '/v1/pdf/rotate', ...body });
    assert.equal(res.statusCode, 202, 'a webhook makes it a job without asking');
    const job = res.json();
    for (let i = 0; i < 100 && calls.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls.length, 2, 'the first attempt failed, the second got through');
    const payload = JSON.parse(calls[1].body);
    assert.deepEqual([payload.id, payload.status, payload.error], [job.id, 'done', null]);
    assert.match(payload.result, new RegExp(`/v1/jobs/${job.id}/result$`));
    const [, t, mac] = /** @type {RegExpExecArray} */ (/^t=(\d+),v1=([0-9a-f]{64})$/.exec(calls[1].signature));
    assert.equal(mac, createHmac('sha256', secret).update(`${t}.${calls[1].body}`).digest('hex'));
    // the receiver has answered; the job records it a moment later
    let view = (await app.inject(job.links.self)).json();
    for (let i = 0; i < 100 && view.webhook.status === 'pending'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      view = (await app.inject(job.links.self)).json();
    }
    assert.deepEqual(view.webhook, { status: 'delivered', attempts: 2 });
  } finally {
    await app.close();
    receiver.close();
  }
});

test('webhooks to private addresses, or without a secret, are refused up front', async () => {
  const noSecret = await buildServer();
  try {
    const res = await noSecret.inject({ method: 'POST', url: '/v1/pdf/rotate', ...(await form([file], { angle: 90, webhook: 'https://example.com/h' })) });
    assert.match(res.json().error.message, /OPENDOCS_WEBHOOK_SECRET/);
  } finally {
    await noSecret.close();
  }
  const app = await buildServer({ webhookSecret: 'whsec-test-0123456789' });
  try {
    for (const hook of ['http://127.0.0.1/h', 'http://169.254.169.254/latest', 'http://10.0.0.1/h', 'ftp://example.com/', 'not a url', 'https://example.com:8443/h']) {
      const res = await app.inject({ method: 'POST', url: '/v1/pdf/rotate', ...(await form([file], { angle: 90, webhook: hook })) });
      assert.ok([400, 403].includes(res.statusCode), `${hook}: ${res.statusCode}`);
    }
  } finally {
    await app.close();
  }
});

test('signatures', () => {
  assert.equal(sign('s', '{}', 1700000000), `t=1700000000,v1=${createHmac('sha256', 's').update('1700000000.{}').digest('hex')}`);
  assert.match(sign('s', 'x'), /^t=\d+,v1=[0-9a-f]{64}$/);
});
