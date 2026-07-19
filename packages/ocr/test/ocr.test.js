import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { textDocument, reportDocument } from '@open-documents/fixtures';
import { renderPages, imagesToPdf, extractText, extractWords, merge, rotate, encrypt } from '@open-documents/core';
import { createOcr, ocr, recognize } from '../src/index.js';
import { languageData, linkOrCopy } from '../src/platform/node.js';
import * as browser from '../src/platform/browser.js';

const require = createRequire(import.meta.url);
const engDir = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

/**
 * A scan of a document: every page drawn to an image and put back as a page with no text.
 *
 * @param {Uint8Array} bytes
 */
async function scan(bytes) {
  const images = await renderPages(bytes, { dpi: 200 });
  return imagesToPdf(images.map((i) => i.data), { pageSize: 'fit', dpi: 200 });
}

const original = await textDocument({ pages: 2 });
const scanned = await scan(original.bytes);
const engine = await createOcr();
after(() => engine.close());

test('a scan has no text until it is read', async () => {
  const [page] = await extractText(scanned);
  assert.equal(page.text.trim(), '');
});

test('a scanned page becomes searchable, with each word where it is on the image', async () => {
  /** @type {import('../src/index.js').PageReport[]} */
  const reports = [];
  const out = await engine.ocr(scanned, { onPage: (r) => reports.push(r) });
  const [one, two] = await extractText(out);
  assert.match(one.text, /The quick brown fox jumps over the lazy dog/);
  assert.match(two.text, /Page 2 of 2/);
  assert.deepEqual(reports.map((r) => [r.page, r.skipped]).sort(), [[1, false], [2, false]]);
  assert.ok(reports.every((r) => /** @type {number} */ (r.confidence) > 80));

  const [before] = await extractWords(original.bytes);
  const [read] = await extractWords(out);
  for (const text of ['quick', 'lazy', 'Page']) {
    const a = /** @type {import('@open-documents/core').Word} */ (before.words.find((w) => w.text === text));
    const b = read.words.find((w) => w.text.startsWith(text));
    assert.ok(b, `"${text}" was read`);
    assert.ok(Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4, `"${text}" at ${b.x}, ${b.y}, not ${a.x}, ${a.y}`);
  }
});

test('the page looks the same afterwards', async () => {
  const out = await engine.ocr(scanned, { pages: [1] });
  const [a] = await renderPages(scanned, { pages: [1], dpi: 50, format: 'rgba' });
  const [b] = await renderPages(out, { pages: [1], dpi: 50, format: 'rgba' });
  assert.deepEqual(b.data, a.data);
});

test('pages that already have text are left alone, unless forced', async () => {
  const mixed = await merge([original.bytes, scanned]); // pages 1-2 have text, 3-4 are scans
  /** @type {import('../src/index.js').PageReport[]} */
  const reports = [];
  const out = await engine.ocr(mixed, { pages: [1, 4], onPage: (r) => reports.push(r) });
  assert.deepEqual(reports.map((r) => [r.page, r.skipped]).sort(), [[1, true], [4, false]]);
  const pages = await extractText(out);
  assert.equal(pages[0].text.match(/quick/g)?.length, 1, 'the page with text is not read again');
  assert.match(pages[3].text, /Page 2 of 2/);

  const forced = await engine.ocr(original.bytes, { pages: [1], force: true });
  const [again] = await extractText(forced);
  assert.equal(again.text.match(/quick/g)?.length, 2, 'forced: the text is there twice');
});

test('nothing to read gives the same document back', async () => {
  const out = await engine.ocr(original.bytes);
  assert.deepEqual(out, original.bytes);
  assert.notEqual(out, original.bytes, 'a copy, not the caller\'s bytes');
});

test('a sideways scan that the PDF turns upright is read as it is shown', async () => {
  // scanned sideways, then turned back by the page's rotation so it shows upright
  const sideways = await scan(await rotate(original.bytes, { angle: 90, pages: [1] }));
  const turned = await rotate(sideways, { angle: -90, pages: [1] });
  const out = await engine.ocr(turned, { pages: [1] });
  const [page] = await extractText(out);
  assert.match(page.text, /quick brown fox/);
  const [words] = await extractWords(out);
  const quick = /** @type {import('@open-documents/core').Word} */ (words.words.find((w) => w.text.startsWith('quick')));
  assert.ok(quick.width > quick.height, 'reads across the page as shown');
});

test('a password-protected scan stays protected', async () => {
  const locked = await encrypt(scanned, { userPassword: 'open sesame' });
  await assert.rejects(engine.ocr(locked), { code: 'PASSWORD_REQUIRED' });
  const out = await engine.ocr(locked, { password: 'open sesame', pages: [1] });
  await assert.rejects(extractText(out), { code: 'PASSWORD_REQUIRED' });
  const [page] = await extractText(out, { password: 'open sesame' });
  assert.match(page.text, /quick brown fox/);
});

test('recognize gives words with their places in points and a confidence', async () => {
  const [page] = await engine.recognize(scanned, { pages: '1' });
  assert.equal(page.page, 1);
  assert.ok(Math.abs(page.width - 612) < 1 && Math.abs(page.height - 792) < 1, `${page.width} x ${page.height}`);
  assert.match(page.text, /quick brown fox/);
  assert.ok(page.confidence > 80);
  const fox = page.words.find((w) => w.text === 'fox');
  assert.ok(fox && fox.confidence > 80);
  const truth = (await extractWords(original.bytes))[0].words.find((w) => w.text === 'fox');
  assert.ok(truth && Math.abs(fox.x - truth.x) < 4 && Math.abs(fox.y - truth.y) < 4, `fox at ${fox.x}, ${fox.y}`);
});

test('the one-call forms start and stop their own engine', async () => {
  const out = await ocr(scanned, { pages: [2], workers: 1 });
  assert.match((await extractText(out))[1].text, /Page 2 of 2/);
  const [page] = await recognize(scanned, { pages: [2], workers: 1, dpi: 150 });
  assert.match(page.text, /Page 2 of 2/);
});

test('bad options are refused before any work', async () => {
  await assert.rejects(createOcr({ languages: [] }), { code: 'INVALID_OPTION' });
  await assert.rejects(createOcr({ languages: ['../eng'] }), { code: 'INVALID_OPTION' });
  await assert.rejects(createOcr({ workers: 0 }), { code: 'INVALID_OPTION' });
  await assert.rejects(createOcr({ languages: ['klingon'] }), { code: 'ENGINE_MISSING', message: /@tesseract\.js-data\/klingon/ });
  await assert.rejects(engine.ocr(scanned, { dpi: 50 }), { code: 'INVALID_OPTION' });
  await assert.rejects(engine.ocr(new Uint8Array([1, 2])), { code: 'INVALID_INPUT' });
  await assert.rejects(engine.ocr(/** @type {any} */ ('a string')), { code: 'INVALID_INPUT' });
  await assert.rejects(engine.recognize(scanned, { pages: [9] }), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(engine.recognize(scanned, { pages: [1.5] }), { code: 'INVALID_OPTION' });
  await assert.rejects(engine.recognize(scanned, { pages: /** @type {any} */ (7) }), { code: 'INVALID_OPTION' });
});

test('a closed engine says so', async () => {
  const short = await createOcr({ workers: 1 });
  await short.close();
  await short.close();
  await assert.rejects(short.ocr(scanned), { code: 'ENGINE_ERROR', message: /closed/ });
});

test('more pages than workers wait their turn', async () => {
  const one = await createOcr({ workers: 1 });
  try {
    const four = await merge([scanned, scanned]);
    const pages = await one.recognize(four);
    assert.deepEqual(pages.map((p) => p.page), [1, 2, 3, 4]);
    assert.ok(pages.every((p) => /quick|Page/.test(p.text)));
  } finally {
    await one.close();
  }
});

test('ArrayBuffer and Blob input work too', async () => {
  const buffer = scanned.buffer.slice(scanned.byteOffset, scanned.byteOffset + scanned.byteLength);
  const [a] = await engine.recognize(buffer, { pages: [1], dpi: 150 });
  const [b] = await engine.recognize(new Blob([scanned]), { pages: [1], dpi: 150 });
  assert.equal(a.text, b.text);
});

test('language data comes from a folder that is given, or from the language packages', async () => {
  const given = mkdtempSync(join(tmpdir(), 'ocr-test-'));
  try {
    writeFileSync(join(given, 'eng.traineddata.gz'), readFileSync(join(engDir, 'eng.traineddata.gz')));
    const [page] = await recognize(scanned, { pages: [1], workers: 1, langPath: given });
    assert.match(page.text, /quick brown fox/);
    assert.throws(() => languageData(['fra'], { langPath: given }), { code: 'ENGINE_MISSING', message: /fra\.traineddata\.gz/ });
  } finally {
    rmSync(given, { recursive: true, force: true });
  }
  // one package: its own folder, nothing to clean up
  const eng = languageData(['eng'], {});
  assert.equal(eng.options.langPath, engDir);
  eng.close();
  // languages from two packages are linked into one private folder, removed on close
  const other = mkdtempSync(join(tmpdir(), 'ocr-other-'));
  try {
    writeFileSync(join(other, 'xyz.traineddata.gz'), 'not real');
    const both = languageData(['eng', 'xyz'], {}, (code) => (code === 'eng' ? join(engDir, 'eng.traineddata.gz') : join(other, 'xyz.traineddata.gz')));
    const folder = /** @type {string} */ (both.options.langPath);
    assert.notEqual(folder, engDir);
    assert.ok(existsSync(join(folder, 'eng.traineddata.gz')) && existsSync(join(folder, 'xyz.traineddata.gz')));
    both.close();
    assert.ok(!existsSync(folder), 'removed on close');
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test('a language folder is linked where it can be and copied where it cannot', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ocr-link-'));
  try {
    const from = join(engDir, 'eng.traineddata.gz');
    linkOrCopy(from, join(folder, 'linked.gz'));
    linkOrCopy(from, join(folder, 'copied.gz'), () => {
      throw new Error('EXDEV');
    });
    assert.ok(existsSync(join(folder, 'linked.gz')) && existsSync(join(folder, 'copied.gz')));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('in a browser, every file must be served by the page, never fetched from a CDN', () => {
  assert.throws(() => browser.languageData(['eng'], {}), { code: 'ENGINE_MISSING', message: /eng\.traineddata\.gz/ });
  assert.deepEqual(browser.languageData(['eng'], { langPath: '/tessdata' }).options, { langPath: '/tessdata' });
  assert.throws(() => browser.workerPaths({ workerPath: '/w.js' }), { code: 'ENGINE_MISSING' });
  assert.deepEqual(browser.workerPaths({ workerPath: '/w.js', corePath: '/core' }), { workerPath: '/w.js', corePath: '/core' });
  const blob = browser.imageInput(new Uint8Array([137, 80]));
  assert.equal(blob.type, 'image/png');
});

test('a ruled table on a scan is read too, not skipped as a picture', async () => {
  const report = await scan((await reportDocument()).bytes);
  const [page] = await engine.recognize(report, { pages: [1] });
  assert.match(page.text, /Region Revenue Costs/);
  assert.match(page.text, /West 1430 910/);
});
