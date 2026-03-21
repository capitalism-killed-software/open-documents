// Needs Chromium (`npx playwright-core install chromium`). Skipped when it cannot start.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pngImage } from '@open-documents/fixtures';
import { extractText, inspect, renderPage } from '@open-documents/core';
import { createChromium } from '../src/index.js';

const chrome = createChromium({ timeout: 20_000 });
let skip = /** @type {string | false} */ (false);
try {
  await chrome.htmlToPdf('<p>warm up</p>');
} catch (err) {
  if (/** @type {any} */ (err).code !== 'ENGINE_MISSING') throw err;
  skip = 'Chromium is not installed';
}
after(() => chrome.close());

/** Records every request a page manages to make. */
/** @type {string[]} */
const hits = [];
const server = createServer((req, res) => {
  hits.push(String(req.url));
  res.writeHead(200, { 'content-type': 'text/plain' }).end('leaked');
});
let base = '';
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
});
after(() => server.close());

/** @param {Uint8Array} pdf */
const textOf = async (pdf) => (await extractText(pdf)).map((p) => p.text).join('\n');

test('html becomes a letter-size pdf with its text', { skip }, async () => {
  const pdf = await chrome.htmlToPdf('<!doctype html><h1>Invoice 1042</h1><p>Total due: $120.00</p>');
  const info = await inspect(pdf);
  assert.deepEqual([info.pages[0].width, info.pages[0].height], [612, 792]);
  assert.match(await textOf(pdf), /Invoice 1042[\s\S]*Total due: \$120\.00/);
});

test('page size: options, landscape, and a CSS @page rule', { skip }, async () => {
  const a4 = await inspect(await chrome.htmlToPdf('<p>x</p>', { format: 'a4', landscape: true }));
  // Chromium rounds A4 to whole hundredths of an inch, so allow a point either way
  assert.ok(Math.abs(a4.pages[0].width - 842) < 2 && Math.abs(a4.pages[0].height - 595) < 2, `${a4.pages[0].width} x ${a4.pages[0].height}`);
  const label = await inspect(await chrome.htmlToPdf('<p>x</p>', { size: { width: '4in', height: '6in' } }));
  assert.deepEqual([label.pages[0].width, label.pages[0].height], [288, 432]);
  const css = await inspect(await chrome.htmlToPdf('<style>@page { size: 5in 5in }</style><p>x</p>'));
  assert.deepEqual([css.pages[0].width, css.pages[0].height], [360, 360]);
});

test('files given with the html are used; relative paths work', { skip }, async () => {
  const html = '<link rel="stylesheet" href="css/print.css"><img src="logo.png" style="width:2in;height:1in"><p class="note">styled</p>';
  const pdf = await chrome.htmlToPdf(html, {
    assets: { 'css/print.css': '.note { color: rgb(0, 128, 0); font-size: 30px }', 'logo.png': pngImage({ width: 40, height: 20 }) },
    margin: { top: '0', left: '0', right: '0', bottom: '0' },
  });
  assert.match(await textOf(pdf), /styled/);
  const img = await renderPage(pdf, { dpi: 72, format: 'rgba' });
  const at = (/** @type {number} */ x, /** @type {number} */ y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  assert.deepEqual(at(20, 30), [255, 0, 0], 'left half of the logo is red');
  assert.deepEqual(at(120, 30), [0, 0, 255], 'right half is blue');
});

test('the page cannot reach the network or the disk', { skip }, async () => {
  hits.length = 0;
  const html = `
    <img src="${base}/img.png">
    <link rel="stylesheet" href="${base}/style.css">
    <iframe src="${base}/frame"></iframe>
    <iframe src="file:///etc/hostname"></iframe>
    <p>still renders</p>`;
  const pdf = await chrome.htmlToPdf(html);
  assert.match(await textOf(pdf), /still renders/);
  assert.deepEqual(hits, []);
});

test('scripts are off unless asked for, and cannot phone home when on', { skip }, async () => {
  hits.length = 0;
  const script = `<p id="out">static</p><script>
    document.getElementById('out').textContent = 'scripted';
    fetch('${base}/beacon').catch(() => {});
    new Image().src = '${base}/pixel';
    try { new WebSocket('${base.replace('http', 'ws')}/ws'); } catch (e) {}
  </script>`;
  assert.match(await textOf(await chrome.htmlToPdf(script)), /static/);
  assert.match(await textOf(await chrome.htmlToPdf(script, { javascript: true })), /scripted/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(hits, []);
});

test('headers and footers with page numbers', { skip }, async () => {
  const pages = Array.from({ length: 3 }, (_, i) => `<p style="page-break-after: always">Section ${i + 1}</p>`).join('');
  const pdf = await chrome.htmlToPdf(pages, {
    footer: '<div style="font-size:10px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { bottom: '0.75in' },
  });
  const text = (await extractText(pdf)).map((p) => p.text);
  assert.equal(text.length, 3);
  assert.match(text[2], /Page 3 of 3/);
});

test('a page that never finishes is stopped', { skip }, async () => {
  const forever = '<script>while (true) {}</script>';
  await assert.rejects(chrome.htmlToPdf(forever, { javascript: true, timeout: 1500 }), { code: 'TIMEOUT' });
  // the converter still works afterwards
  assert.match(await textOf(await chrome.htmlToPdf('<p>after</p>')), /after/);
});

test('bad options are refused', { skip }, async () => {
  await assert.rejects(chrome.htmlToPdf(/** @type {any} */ (5)), { code: 'INVALID_INPUT' });
  await assert.rejects(chrome.htmlToPdf('<p>x</p>', { scale: 5 }), { code: 'INVALID_OPTION' });
  await assert.rejects(chrome.htmlToPdf('<p>x</p>', { format: /** @type {any} */ ('b5') }), { code: 'INVALID_OPTION' });
});

test('a missing Chromium is reported', async () => {
  const missing = createChromium({ executablePath: '/nonexistent/chrome' });
  await assert.rejects(missing.htmlToPdf('<p>x</p>'), { code: 'ENGINE_MISSING' });
  await missing.close();
});

/** A small site: a page, a page with an image from elsewhere, and a redirect. */
function site() {
  /** @type {string[]} */
  const seen = [];
  const s = createServer((req, res) => {
    seen.push(String(req.url));
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Public page</h1>');
    if (req.url?.startsWith('/with-image')) {
      const port = new URL(req.url, 'http://x').searchParams.get('port');
      return res.writeHead(200, { 'content-type': 'text/html' }).end(`<p>Has an image</p><img src="http://localhost:${port}/private.png">`);
    }
    if (req.url?.startsWith('/redirect')) {
      const port = new URL(req.url, 'http://x').searchParams.get('port');
      return res.writeHead(302, { location: `http://localhost:${port}/admin` }).end();
    }
    res.writeHead(404).end();
  });
  return { server: s, seen };
}

test('a web page through the proxy', { skip }, async () => {
  const { server, seen } = site();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  try {
    const pdf = await chrome.urlToPdf(`http://127.0.0.1:${port}/`, { allowHosts: ['127.0.0.1'] });
    assert.match(await textOf(pdf), /Public page/);
    assert.ok(seen.includes('/'));
  } finally {
    server.close();
  }
});

test('private addresses are refused, even on this machine', { skip }, async () => {
  hits.length = 0;
  await assert.rejects(chrome.urlToPdf(`${base}/admin`), { code: 'BLOCKED', message: /127\.0\.0\.1/ });
  await assert.rejects(chrome.urlToPdf(base.replace('127.0.0.1', 'localhost') + '/admin'), { code: 'BLOCKED' });
  await assert.rejects(chrome.urlToPdf('http://169.254.169.254/latest/meta-data/'), { code: 'BLOCKED' });
  assert.deepEqual(hits, []);
});

test('an allowed page cannot pull in private things or redirect to them', { skip }, async () => {
  const { server } = site();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const privatePort = Number(new URL(base).port);
  try {
    hits.length = 0;
    const pdf = await chrome.urlToPdf(`http://127.0.0.1:${port}/with-image?port=${privatePort}`, { allowHosts: ['127.0.0.1'] });
    assert.match(await textOf(pdf), /Has an image/);
    await assert.rejects(chrome.urlToPdf(`http://127.0.0.1:${port}/redirect?port=${privatePort}`, { allowHosts: ['127.0.0.1'] }), { code: 'BLOCKED', message: /localhost/ });
    assert.deepEqual(hits, [], 'the private server was never reached');
  } finally {
    server.close();
  }
});

test('only web addresses', { skip }, async () => {
  await assert.rejects(chrome.urlToPdf('file:///etc/passwd'), { code: 'INVALID_OPTION' });
  await assert.rejects(chrome.urlToPdf('not a url'), { code: 'INVALID_INPUT' });
});
