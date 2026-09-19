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

/** @param {import('playwright-core').Page} page */
const savedFrom = async (page) => new Uint8Array(await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save())));

test('organise from code: rotate, delete, move', { skip }, async () => {
  const { extractText } = await import('@open-documents/core');
  const firstLines = async (/** @type {Uint8Array} */ b) => (await extractText(b)).map((p) => p.text.split('\n')[0]);
  const { page } = await open();
  try {
    const events = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).rotatePages([2], 90));
    assert.deepEqual((await inspect(await savedFrom(page))).pages.map((p) => p.rotation), [0, 90, 0, 0, 0]);
    const after = await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).deletePages([3]));
    assert.deepEqual(after, { pageCount: 4 });
    assert.deepEqual(await firstLines(await savedFrom(page)), ['Page 1 line 1', 'Page 2 line 1', 'Page 4 line 1', 'Page 5 line 1']);
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).movePage(4, 1));
    assert.deepEqual(await firstLines(await savedFrom(page)), ['Page 5 line 1', 'Page 1 line 1', 'Page 2 line 1', 'Page 4 line 1']);
    assert.equal(await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).page), 1, 'shows the page that moved');
    const kinds = await page.evaluate((list) => list.map((e) => `${e.type}:${e.action}`), events);
    assert.deepEqual(kinds, ['pages:rotate', 'pages:delete', 'pages:move']);
  } finally {
    await page.close();
  }
});

test('organise with the thumbnails: buttons and dragging', { skip }, async () => {
  const { extractText } = await import('@open-documents/core');
  const { page } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('organize', 'true'));
    await inViewer(page, 'button[aria-label="Turn page 1 right"]').click();
    await page.waitForFunction(async () => {
      const v = /** @type {any} */ (document.getElementById('v'));
      return v.shadowRoot.querySelector('.sidebar:not(.busy)') && v.pageCount === 5;
    });
    await page.waitForTimeout(300);
    assert.equal((await inspect(await savedFrom(page))).pages[0].rotation, 90);
    await inViewer(page, '[data-thumb="3"]').dragTo(inViewer(page, '[data-thumb="1"]'));
    await page.waitForFunction(() => !(/** @type {any} */ (document.getElementById('v')).shadowRoot.querySelector('.sidebar.busy')));
    await page.waitForTimeout(500);
    const texts = (await extractText(await savedFrom(page))).map((p) => p.text.split('\n')[0]);
    assert.equal(texts[0], 'Page 3 line 1', `order now ${texts.join(' | ')}`);
  } finally {
    await page.close();
  }
});

test('annotations move with their page', { skip }, async () => {
  const { page } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('annotate', 'true'));
    const made = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await inViewer(page, 'button[data-tool="ink"]').click();
    const box = /** @type {{ x: number, y: number }} */ (await inViewer(page, '.page[data-page="1"]').boundingBox());
    await page.mouse.move(box.x + 100, box.y + 200);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 100 + i * 20, box.y + 220 + (i % 2) * 20);
    await page.mouse.up();
    await page.waitForFunction((list) => list.some((c) => c.type === 'create'), made);
    assert.deepEqual((await annotationsIn(await savedFrom(page)))[0], ['Ink'], 'the stroke is on page 1');
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).movePage(1, 3));
    const pages = await annotationsIn(await savedFrom(page));
    assert.deepEqual(pages.map((p) => p.includes('Ink')), [false, false, true, false, false]);
  } finally {
    await page.close();
  }
});

test('forms: read the fields, fill them from code and by typing, save', { skip }, async () => {
  const { formDocument } = await import('@open-documents/fixtures');
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const page = await /** @type {import('playwright-core').Browser} */ (browser).newPage({ viewport: { width: 900, height: 760 } });
  try {
    await page.goto(`${base}/`);
    const form = await formDocument();
    await page.evaluate(async (bytes) => /** @type {any} */ (document.getElementById('v')).load(new Uint8Array(bytes), { name: 'form.pdf' }), Array.from(form.bytes));
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).formFields().length === 4);
    const fields = await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).formFields().map((/** @type {any} */ f) => f.name).sort());
    assert.deepEqual(fields, ['agree', 'colour', 'name', 'notes']);
    const values = await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).getFormValues());
    assert.equal(values.name, 'Sample Person');
    assert.equal(values.colour, 'green');

    const changes = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setFormValues({ notes: 'Filled from code', colour: 'blue' }));
    // typing into the field on the page
    const input = page.locator('#v >> css=.page[data-page="1"] input:not([type="checkbox"]):not([type="radio"])').first();
    await input.click();
    await input.press('Control+a');
    await input.type('Typed Name');
    await input.press('Tab');
    // the field may report a change part way through the typing; wait for the whole value
    await page.waitForFunction((list) => list.some((c) => c.type === 'field' && c.name === 'name' && c.value === 'Typed Name'), changes, { timeout: 5000 }).catch(async () => {
      throw new Error(`no change for the name field: ${JSON.stringify(await page.evaluate((list) => list, changes))}`);
    });

    const saved = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const filled = (await PDFDocument.load(new Uint8Array(saved))).getForm();
    assert.equal(filled.getTextField('notes').getText(), 'Filled from code');
    assert.deepEqual(filled.getDropdown('colour').getSelected(), ['blue']);
    assert.equal(filled.getTextField('name').getText(), 'Typed Name');
    // keystrokes are written in order, so the last change reported is the whole value
    const names = await page.evaluate((list) => list.filter((c) => c.type === 'field' && c.name === 'name').map((c) => c.value), changes);
    assert.equal(names.at(-1), 'Typed Name', JSON.stringify(names));
  } finally {
    await page.close();
  }
});

test('design: draw a text field and a dropdown, name them, and they are real fields', { skip }, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('design', 'true'));
    const changes = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await inViewer(page, 'button[data-field-tool="text"]').click();
    const first = inViewer(page, '.page[data-page="1"]');
    const at = /** @type {{ x: number, y: number }} */ (await first.boundingBox());
    await page.mouse.move(at.x + 100, at.y + 120);
    await page.mouse.down();
    await page.mouse.move(at.x + 250, at.y + 140, { steps: 5 });
    await page.mouse.up();
    const nameBox = inViewer(page, '.draft-panel input[name="field-name"]');
    assert.equal(await nameBox.inputValue(), 'text1');
    await nameBox.fill('applicant');
    await inViewer(page, '.draft-panel button[type="submit"]').click();
    await page.waitForFunction((list) => list.some((c) => c.type === 'fields' && c.names?.[0] === 'applicant'), changes);
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).formFields().some((/** @type {any} */ f) => f.name === 'applicant'));

    // a dropdown with options, by clicking once
    await inViewer(page, 'button[data-field-tool="dropdown"]').click();
    const again = /** @type {{ x: number, y: number }} */ (await inViewer(page, '.page[data-page="1"]').boundingBox());
    await page.mouse.click(again.x + 100, again.y + 200);
    await inViewer(page, '.draft-panel input[name="field-options"]').fill('small, large');
    await inViewer(page, '.draft-panel button[type="submit"]').click();
    await page.waitForFunction(() => /** @type {any} */ (document.getElementById('v')).formFields().some((/** @type {any} */ f) => f.name === 'choice1'));

    // a name already taken is refused, with the reason shown
    await inViewer(page, 'button[data-field-tool="text"]').click();
    const third = /** @type {{ x: number, y: number }} */ (await inViewer(page, '.page[data-page="1"]').boundingBox());
    await page.mouse.click(third.x + 300, third.y + 300);
    await inViewer(page, '.draft-panel input[name="field-name"]').fill('applicant');
    await inViewer(page, '.draft-panel button[type="submit"]').click();
    await inViewer(page, '.draft-error').waitFor();
    assert.match(await inViewer(page, '.draft-error').innerText(), /already a field named "applicant"/);
    await inViewer(page, '.draft-panel button[type="button"]').click();

    const saved = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const { getFormFields } = await import('@open-documents/core');
    const fields = await getFormFields(new Uint8Array(saved));
    const applicant = fields.find((f) => f.name === 'applicant');
    const choice = fields.find((f) => f.name === 'choice1');
    assert.equal(applicant?.type, 'text');
    assert.deepEqual(choice?.options, ['small', 'large']);
    const zoom = await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.getElementById('v')?.shadowRoot?.querySelector('.page[data-page="1"]'));
      return el.getBoundingClientRect().width / 612;
    });
    const w = /** @type {import('@open-documents/core').FormField} */ (applicant).widgets[0];
    assert.ok(Math.abs(w.x - 100 / zoom) < 3 && Math.abs(w.y - 120 / zoom) < 3 && Math.abs(w.width - 150 / zoom) < 3, JSON.stringify(w));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('addFormFields from code', { skip }, async () => {
  const { page } = await open();
  try {
    const result = await page.evaluate(async () => {
      const v = /** @type {any} */ (document.getElementById('v'));
      await v.addFormFields([{ type: 'checkbox', name: 'agree', page: 2, x: 72, y: 100, width: 14, height: 14 }]);
      return v.formFields().map((/** @type {any} */ f) => f.name);
    });
    assert.deepEqual(result, ['agree']);
  } finally {
    await page.close();
  }
});

test('redact: mark an area, apply, and what was there is gone for good', { skip }, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('redact', 'true'));
    const changes = await page.evaluateHandle(() => {
      const list = /** @type {any[]} */ ([]);
      document.getElementById('v')?.addEventListener('od-change', (/** @type {any} */ e) => list.push(e.detail));
      return list;
    });
    await inViewer(page, 'button[data-redact="mark"]').click();
    const zoom = await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.getElementById('v')?.shadowRoot?.querySelector('.page[data-page="1"]'));
      return el.getBoundingClientRect().width / 612;
    });
    const at = /** @type {{ x: number, y: number }} */ (await inViewer(page, '.page[data-page="1"]').boundingBox());
    // the first line of page 1 starts at 72 points across, its baseline 72 points down
    await page.mouse.move(at.x + 60 * zoom, at.y + 58 * zoom);
    await page.mouse.down();
    await page.mouse.move(at.x + 200 * zoom, at.y + 76 * zoom, { steps: 5 });
    await page.mouse.up();
    assert.equal(await inViewer(page, '.mark').count(), 1);
    assert.match(await inViewer(page, 'button[data-redact="apply"]').innerText(), /Redact 1 area/);
    await inViewer(page, 'button[data-redact="apply"]').click();
    await page.waitForFunction((list) => list.some((c) => c.type === 'redaction'), changes);
    const change = await page.evaluate((list) => list.find((c) => c.type === 'redaction'), changes);
    assert.deepEqual([change.pages, change.report.verification.ok], [[1], true]);
    await inViewer(page, '[part="redaction-toolbar"] [role="status"]').filter({ hasText: 'Redacted and checked.' }).waitFor();
    const saved = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const { extractText } = await import('@open-documents/core');
    const [first] = await extractText(new Uint8Array(saved), { pages: [1] });
    assert.doesNotMatch(first.text.split('\n')[0], /line 1\b/, 'the first line is gone');
    assert.match(first.text, /Page 1 line 2/, 'the next line stays');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('redact from code, and a signature field from the designer tools', { skip }, async () => {
  const { page } = await open();
  try {
    const report = await page.evaluate(async () => /** @type {any} */ (document.getElementById('v')).redact({ text: ['Page 3 line 5'] }));
    assert.deepEqual(report.matches, [{ pattern: 'Page 3 line 5', page: 3, count: 1 }]);
    await page.evaluate(() => /** @type {any} */ (document.getElementById('v')).setAttribute('design', 'true'));
    assert.equal(await inViewer(page, 'button[data-field-tool="signature"]').innerText(), 'Signature');
    await page.evaluate(async () => /** @type {any} */ (document.getElementById('v')).addFormFields([{ type: 'signature', name: 'approver', page: 1, x: 72, y: 600, width: 200, height: 50 }]));
    const saved = await page.evaluate(async () => Array.from(await /** @type {any} */ (document.getElementById('v')).save()));
    const { getFormFields } = await import('@open-documents/core');
    assert.deepEqual((await getFormFields(new Uint8Array(saved))).map((f) => [f.name, f.type]), [['approver', 'signature']]);
  } finally {
    await page.close();
  }
});
