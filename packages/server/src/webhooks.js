// Telling a caller's server that a job is done. The body is signed so the receiver can check it
// came from us and is fresh; the address gets the same checks as a web page, so a webhook can
// never be pointed at this server's private network.
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { OpenDocumentsError } from '@open-documents/core';
import { isPublicAddress } from '@open-documents/node';

/**
 * Sign a body: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, as in the
 * Opendocs-Signature header.
 *
 * @param {string} secret
 * @param {string} body
 * @param {number} [time]  unix seconds
 */
export function sign(secret, body, time = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex');
  return `t=${time},v1=${mac}`;
}

/**
 * @typedef {object} WebhookOptions
 * @property {string} secret
 * @property {string[]} [allowHosts]
 * @property {number[]} [delays]  milliseconds before each retry; default 1 s, 5 s, 25 s
 * @property {number} [timeout]   per attempt; default 10 s
 */

/**
 * Check a webhook address now, so a bad one is refused before any work is done.
 *
 * @param {string} url
 * @param {WebhookOptions} options
 * @returns {Promise<string>} the address to connect to
 */
export async function checkWebhook(url, options) {
  if (typeof url !== 'string' || !URL.canParse(url)) throw new OpenDocumentsError('INVALID_OPTION', 'webhook must be an http or https address.');
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new OpenDocumentsError('INVALID_OPTION', 'webhook must be an http or https address.');
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = (options.allowHosts ?? []).map((h) => h.toLowerCase()).includes(host);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (!allowed && port !== 80 && port !== 443) throw new OpenDocumentsError('BLOCKED', `Webhooks may only use ports 80 and 443, not ${port}.`);
  const answers = isIP(host) ? [{ address: host }] : await dnsLookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!answers.length) throw new OpenDocumentsError('BLOCKED', `The webhook host ${host} does not resolve.`);
  if (!allowed) {
    const bad = answers.find((a) => !isPublicAddress(a.address));
    if (bad) throw new OpenDocumentsError('BLOCKED', `Webhooks cannot go to ${host}: ${bad.address} is not a public address.`);
  }
  return answers[0].address;
}

/**
 * Deliver a job's outcome, retrying with backoff. Resolves either way; the job records how it went.
 *
 * @param {import('./jobs.js').Job} job
 * @param {string} resultUrl  where the caller fetches the result
 * @param {WebhookOptions} options
 */
export async function deliver(job, resultUrl, options) {
  const hook = /** @type {NonNullable<import('./jobs.js').Job['webhook']>} */ (job.webhook);
  const body = JSON.stringify({ id: job.id, status: job.status, error: job.error, result: job.status === 'done' ? resultUrl : null });
  const delays = options.delays ?? [1000, 5000, 25000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    hook.attempts = attempt + 1;
    try {
      const address = await checkWebhook(hook.url, options);
      const status = await post(hook.url, address, body, sign(options.secret, body), options.timeout ?? 10_000);
      if (status >= 200 && status < 300) {
        hook.status = 'delivered';
        return;
      }
    } catch {
      // try again
    }
    if (attempt < delays.length) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
  hook.status = 'failed';
}

/**
 * POST to the address we checked, keeping the host name for TLS and the Host header.
 *
 * @param {string} url
 * @param {string} address
 * @param {string} body
 * @param {string} signature
 * @param {number} timeout
 * @returns {Promise<number>}
 */
function post(url, address, body, signature, timeout) {
  const target = new URL(url);
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(target, {
      method: 'POST',
      timeout,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'opendocs-signature': signature, 'user-agent': 'open-documents-webhook' },
      lookup: (_host, opts, cb) => {
        const family = isIP(address);
        if (/** @type {any} */ (opts).all) cb(null, [{ address, family }]);
        else cb(null, address, family);
      },
    }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
