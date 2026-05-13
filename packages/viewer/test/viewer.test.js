// The viewer in a real browser. Needs Chromium (`npx playwright-core install chromium`);
// skipped when it cannot start.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { textDocument } from '@open-documents/fixtures';
import { inspect } from '@open-documents/core';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
let dir = '';
/** @type {import('node:http').Server} */
let server;
let base = '';
/** @type {import('playwright-core').Browser | null} */
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  browser = null;
}
const skip = browser ? false : 'Chromium is not installed';

before(async () => {
  if (!browser) return;
  dir = await mkdtemp(join(tmpdir(), 'od-viewer-'));
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', outfile: join(dir, 'viewer.js'), logLevel: 'silent' });
  await copyFile(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')), join(dir, 'pdfium.wasm'));
  const lines = (/** @type {number} */ n) => Array.from({ length: 30 }, (_, i) => `Page ${n} line ${i + 1}`);
  await writeFile(join(dir, 'five.pdf'), (await textDocument({ pages: 5, lines })).bytes);
  await writeFile(join(dir, 'locked.pdf'), (await textDocument({ pages: 2, encrypt: { userPassword: 'open' } })).bytes);
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
    <script type="module" src="./viewer.js"></script></head><body>
    <od-viewer id="v" wasm-url="./pdfium.wasm" style="--od-height: 640px; width: 820px"></od-viewer>
    </body></html>`);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const body = await readFile(join(dir, path === '/' ? 'index.html' : path.slice(1)));
      res.writeHead(200, { 'content-type': types[/** @type {keyof types} */ (extname(path) || '.html')] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
});

after(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** A page with the viewer, a five-page PDF loaded. */
async function open() {
  const page = await /** @type {import('playwright-core').Browser} */ (browser).newPage({ viewport: { width: 900, height: 760 } });
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);
  const loaded = await page.evaluate(async () => {
    const v = /** @type {any} */ (document.getElementById('v'));
    const events = /** @type {any[]} */ ([]);
    v.addEventListener('od-load', (/** @type {any} */ e) => events.push(e.detail));
    const result = await v.load('./five.pdf');
    return { result, events };
  });
  await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).shadowRoot.querySelectorAll('.page img').length > 0);
  return { page, loaded, errors };
}

/** @param {import('playwright-core').Page} page @param {string} selector */
const inViewer = (page, selector) => page.locator(`#v >> css=${selector}`);

test('loads a document and draws its pages', { skip }, async () => {
  const { page, loaded, errors } = await open();
  try {
    assert.deepEqual(loaded.result, { pageCount: 5 });
    assert.deepEqual(loaded.events, [{ pageCount: 5, name: 'five.pdf' }]);
    assert.match(await inViewer(page, '.bar').innerText(), /of 5/);
    assert.ok((await inViewer(page, '.page').count()) >= 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('moves between pages and reports where it is', { skip }, async () => {
  const { page } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).goToPage(3));
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).page === 3);
    assert.equal(await inViewer(page, '.page-input').inputValue(), '3');
    await inViewer(page, 'button[aria-label="Next page"]').click();
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).page === 4);
    await inViewer(page, '.page-input').fill('1');
    await inViewer(page, '.page-input').press('Enter');
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).page === 1);
  } finally {
    await page.close();
  }
});

test('zooms in and out', { skip }, async () => {
  const { page } = await open();
  try {
    const level = async () => Number((await inViewer(page, '.bar').innerText()).match(/(\d+)%/)?.[1]);
    const start = await level();
    await inViewer(page, 'button[aria-label="Zoom in"]').click();
    await page.waitForFunction(async (s) => Number(/** @type {any} */ (document.getElementById('v')).shadowRoot.querySelector('.bar').textContent.match(/(\d+)%/)?.[1]) > s, start);
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).zoomOut());
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).fitWidth());
    await page.waitForFunction((s) => Number(/** @type {any} */ (document.getElementById('v')).shadowRoot.querySelector('.bar').textContent.match(/(\d+)%/)?.[1]) === s, start);
  } finally {
    await page.close();
  }
});

test('finds text, from the box and from code', { skip }, async () => {
  const { page } = await open();
  try {
    const count = await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).search('line 30'));
    assert.equal(count, 5);
    await inViewer(page, '.search').fill('Page 4 line 2');
    await inViewer(page, '.search').press('Enter');
    // results arrive page by page, so wait for the count to settle: "Page 4 line 2" also
    // matches lines 20 to 29
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).shadowRoot.querySelector('.results').textContent === '1 of 11');
    await inViewer(page, 'button[aria-label="Next match"]').click();
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).shadowRoot.querySelector('.results').textContent === '2 of 11');
  } finally {
    await page.close();
  }
});

test('page thumbnails open and take you to a page', { skip }, async () => {
  const { page } = await open();
  try {
    await inViewer(page, 'button[aria-label="Show pages"]').click();
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).shadowRoot.querySelectorAll('.thumb img').length >= 2);
    await inViewer(page, '.thumb >> nth=1').click();
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).page === 2);
  } finally {
    await page.close();
  }
});

test('save hands back the document as PDF bytes', { skip }, async () => {
  const { page } = await open();
  try {
    const bytes = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const info = await inspect(new Uint8Array(bytes));
    assert.equal(info.pageCount, 5);
  } finally {
    await page.close();
  }
});

test('encrypted files need their password', { skip }, async () => {
  const { page } = await open();
  try {
    const refused = await page.evaluate(async () => {
      const v = /** @type {any} */ (document.getElementById('v'));
      const seen = /** @type {any[]} */ ([]);
      v.addEventListener('od-error', (/** @type {any} */ e) => seen.push(e.detail.code));
      const failure = await v.load('./locked.pdf').then(() => null, (/** @type {any} */ e) => e.code);
      return { failure, seen };
    });
    assert.equal(refused.failure, 'PASSWORD_REQUIRED');
    assert.deepEqual(refused.seen, ['PASSWORD_REQUIRED']);
    const ok = await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).load('./locked.pdf', { password: 'open' }));
    assert.deepEqual(ok, { pageCount: 2 });
  } finally {
    await page.close();
  }
});

test('the src attribute, and a missing wasm-url', { skip }, async () => {
  const page = await /** @type {import('playwright-core').Browser} */ (browser).newPage();
  try {
    await page.goto(`${base}/`);
    const count = await page.evaluate(() => new Promise((resolve) => {
      const v = document.createElement('od-viewer');
      v.setAttribute('wasm-url', './pdfium.wasm');
      v.addEventListener('od-load', (/** @type {any} */ e) => resolve(e.detail.pageCount));
      v.setAttribute('src', './five.pdf');
      document.body.append(v);
    }));
    assert.equal(count, 5);
    const message = await page.evaluate(() => {
      const v = document.createElement('od-viewer');
      document.body.append(v);
      return /** @type {ShadowRoot} */ (v.shadowRoot).textContent;
    });
    assert.match(String(message), /wasm-url/);
  } finally {
    await page.close();
  }
});

test('goToPage straight after load lands on that page', { skip }, async () => {
  const { page } = await open();
  try {
    await page.evaluate(async () => {
      const v = /** @type {any} */ (document.getElementById('v'));
      await v.load('./five.pdf');
      v.goToPage(4);
    });
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).page === 4);
    // and it stays there: the first fit-to-width zoom does not throw it back to the top
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => {
      const v = /** @type {any} */ (document.getElementById('v'));
      return { page: v.page, scrolled: v.shadowRoot.querySelector('.viewport').scrollTop };
    });
    assert.equal(state.page, 4);
    assert.ok(state.scrolled > 1000, `scrolled ${state.scrolled}px`);
  } finally {
    await page.close();
  }
});

/**
 * Annotation subtypes on each page of a saved PDF, read with pdf-lib.
 * @param {Uint8Array} bytes
 */
async function annotationsIn(bytes) {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return [];
    return Array.from({ length: annots.size() }, (_, i) => String(/** @type {any} */ (annots.lookup(i, PDFDict)).get(PDFName.of('Subtype'))).slice(1));
  });
}

test('annotate: draw with the pen, add a note, undo it, save', { skip }, async () => {
  const { page } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('annotate', 'true'));
    await inViewer(page, 'button[data-tool="ink"]').waitFor();
    const changes = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await inViewer(page, 'button[data-tool="ink"]').click();
    assert.equal(await inViewer(page, 'button[data-tool="ink"]').getAttribute('aria-pressed'), 'true');
    const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await inViewer(page, '.page[data-page="1"]').boundingBox());
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i * 20, box.y + 200 + (i % 2) * 30);
    await page.mouse.up();
    await page.waitForFunction((list) => list.some((c) => c.type === 'create'), changes);

    await inViewer(page, 'button[data-tool="textComment"]').click();
    await page.mouse.click(box.x + 300, box.y + 120);
    await page.waitForFunction((list) => list.filter((c) => c.type === 'create').length >= 2, changes);
    const kinds = await page.evaluate((list) => list.filter((c) => c.type === 'create').map((c) => c.annotation), changes);
    assert.deepEqual(kinds.slice(0, 2), ['ink', 'text']);

    const saved = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const first = (await annotationsIn(new Uint8Array(saved)))[0];
    assert.ok(first.includes('Ink'), `ink on page 1: ${first}`);
    assert.ok(first.includes('Text'), `a note on page 1: ${first}`);

    await inViewer(page, 'button[aria-label="Undo"]').click();
    await page.waitForTimeout(300);
    const undone = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const after = (await annotationsIn(new Uint8Array(undone)))[0];
    assert.ok(after.includes('Ink') && !after.includes('Text'), `the note is gone, the ink stays: ${after}`);
  } finally {
    await page.close();
  }
});
