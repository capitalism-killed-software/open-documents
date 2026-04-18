import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { textDocument, pngImage, jpegImage } from '@open-documents/fixtures';
import { inspect, extractText, extractWords, getBookmarks, setBookmarks } from '@open-documents/core';
import { main } from '../src/main.js';

const BIN = fileURLToPath(new URL('../bin/opendocs.js', import.meta.url));
let dir = '';
let pdf = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opendocs-'));
  pdf = join(dir, 'sample.pdf');
  await writeFile(pdf, (await textDocument({ pages: 3, rotation: [0, 90, 0] })).bytes);
});
after(() => rm(dir, { recursive: true, force: true }));

/** @param {string[]} args */
async function run(args) {
  let out = '';
  let err = '';
  const code = await main(args, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

test('info prints a summary', async () => {
  const { code, out } = await run(['info', pdf]);
  assert.equal(code, 0);
  assert.match(out, /^Pages\s+3$/m);
  assert.match(out, /612 x 792 pt \(2\)/);
  assert.match(out, /792 x 612 pt, turned 90 \(1\)/);
  assert.match(out, /^Title\s+Fixture$/m);
});

test('info --json prints everything', async () => {
  const { code, out } = await run(['info', pdf, '--json']);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).pageCount, 3);
});

test('text prints every page, or the pages asked for', async () => {
  const all = await run(['text', pdf]);
  assert.equal(all.code, 0);
  assert.equal(all.out.split('\f').length, 3);
  const some = await run(['text', pdf, '--pages', '3']);
  assert.equal(some.out, 'Page 3 of 3\nThe quick brown fox jumps over the lazy dog.\n');
});

test('render writes a png', async () => {
  const target = join(dir, 'page2.png');
  const { code, out } = await run(['render', pdf, '--page', '2', '--dpi', '36', '-o', target]);
  assert.equal(code, 0);
  assert.match(out, /396 x 306/);
  const png = await readFile(target);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});

test('render names the file after the input when no -o is given', async () => {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { out } = await run(['render', pdf, '--width', '100']);
    assert.match(out, /^sample-1\.png {2}100 x 129/);
  } finally {
    process.chdir(cwd);
  }
});

test('mistakes get a message and a non-zero exit', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['--help'])).code, 0);
  assert.match((await run(['frobnicate', pdf])).err, /Unknown command/);
  assert.match((await run(['info'])).err, /needs one PDF file/);
  assert.match((await run(['info', pdf, pdf])).err, /needs one PDF file/);
  assert.match((await run(['merge', pdf])).err, /two or more/);
  assert.match((await run(['info', '--nope'])).err, /Unknown option/);
  const missing = await run(['info', join(dir, 'missing.pdf')]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /no such file/);
  const badPage = await run(['render', pdf, '--page', '9']);
  assert.equal(badPage.code, 1);
  assert.match(badPage.err, /^error: Page 9 does not exist/);
  assert.match((await run(['render', pdf, '--dpi', 'lots'])).err, /--dpi must be a whole number/);
});

test('the installed command runs', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [BIN, 'info', pdf]);
  assert.match(stdout, /^Pages\s+3$/m);
});

/** @param {string} file */
const pagesOf = async (file) => (await inspect(await readFile(file))).pageCount;

test('merge joins files', async () => {
  const target = join(dir, 'both.pdf');
  const { code, out } = await run(['merge', pdf, pdf, '-o', target]);
  assert.equal(code, 0);
  assert.match(out, /both\.pdf {2}6 pages/);
  assert.equal(await pagesOf(target), 6);
});

test('merge will not write over one of its inputs', async () => {
  const { code, err } = await run(['merge', pdf, pdf, '-o', pdf]);
  assert.equal(code, 1);
  assert.match(err, /Not writing over the input file/);
});

test('split writes numbered parts into a folder', async () => {
  const { code, out } = await run(['split', pdf, '--every', '2', '-o', dir]);
  assert.equal(code, 0);
  assert.match(out, /sample-1\.pdf {2}2 pages\n.*sample-2\.pdf {2}1 page\n/s);
  const byRanges = await run(['split', pdf, '--ranges', '1;2-3', '-o', dir]);
  assert.match(byRanges.out, /sample-2\.pdf {2}2 pages/);
  const byAt = await run(['split', pdf, '--at', '2,3', '-o', dir]);
  assert.match(byAt.out, /sample-3\.pdf {2}1 page/);
});

test('page commands write <name>-<command>.pdf by default', async () => {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.match((await run(['extract', pdf, '--pages', '2-3'])).out, /^sample-extract\.pdf {2}2 pages/);
    assert.match((await run(['remove', pdf, '--pages', '1'])).out, /^sample-remove\.pdf {2}2 pages/);
    assert.match((await run(['reorder', pdf, '--order', '3,2,1'])).out, /^sample-reorder\.pdf {2}3 pages/);
    const texts = (await extractText(await readFile('sample-reorder.pdf'))).map((p) => p.text.split('\n')[0]);
    assert.deepEqual(texts, ['Page 3 of 3', 'Page 2 of 3', 'Page 1 of 3']);
  } finally {
    process.chdir(cwd);
  }
});

test('rotate, slice, crop, nup and blank', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  assert.equal((await run(['rotate', pdf, '--angle=-90', '--pages', '1', '-o', o('r.pdf')])).code, 0);
  assert.equal((await inspect(await readFile(o('r.pdf')))).pages[0].rotation, 270);
  assert.equal((await run(['slice', pdf, '--columns', '2', '--pages', '1', '-o', o('s.pdf')])).code, 0);
  assert.equal(await pagesOf(o('s.pdf')), 4);
  assert.equal((await run(['crop', pdf, '--margins', '36', '-o', o('c.pdf')])).code, 0);
  assert.equal((await inspect(await readFile(o('c.pdf')))).pages[0].width, 540);
  assert.equal((await run(['crop', pdf, '--margins', '0,0,0,72', '-o', o('c4.pdf')])).code, 0);
  assert.equal((await inspect(await readFile(o('c4.pdf')))).pages[0].width, 540);
  assert.equal((await run(['nup', pdf, '--columns', '2', '--rows', '2', '-o', o('n.pdf')])).code, 0);
  assert.equal(await pagesOf(o('n.pdf')), 1);
  assert.equal((await run(['blank', pdf, '--at', '4', '--count', '2', '-o', o('b.pdf')])).code, 0);
  assert.equal(await pagesOf(o('b.pdf')), 5);
});

test('page commands explain what they need', async () => {
  assert.match((await run(['extract', pdf])).err, /needs --pages/);
  assert.match((await run(['rotate', pdf, '--angle', 'left'])).err, /--angle must be a whole number/);
  assert.match((await run(['crop', pdf, '--margins', '1,2'])).err, /one number or four/);
  assert.match((await run(['crop', pdf, '--margins', 'wide'])).err, /--margins must be a number/);
  assert.match((await run(['blank', pdf])).err, /needs --at/);
});

/** @param {string} file */
const wordsOf = async (file) => (await extractWords(await readFile(file))).flatMap((p) => p.words.map((w) => w.text));

test('stamp, watermark, numbers, header-footer and bates', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  assert.equal((await run(['stamp', pdf, '--text', 'Approved', '--at', '72,300', '--size', '14', '-o', o('st.pdf')])).code, 0);
  assert.ok((await wordsOf(o('st.pdf'))).includes('Approved'));
  assert.equal((await run(['watermark', pdf, '--text', 'DRAFT', '--color', '#ff0000', '--opacity', '0.3', '--angle=-30', '--behind', '-o', o('wm.pdf')])).code, 0);
  assert.equal((await wordsOf(o('wm.pdf'))).filter((w) => w === 'DRAFT').length, 3);
  assert.equal((await run(['numbers', pdf, '--format', '#{n}', '--start', '5', '-o', o('nu.pdf')])).code, 0);
  assert.ok((await wordsOf(o('nu.pdf'))).includes('#7'));
  assert.equal((await run(['header-footer', pdf, '--header', 'Left||Right', '--footer', '|{n}/{total}|', '-o', o('hf.pdf')])).code, 0);
  const hf = await wordsOf(o('hf.pdf'));
  assert.ok(hf.includes('Left') && hf.includes('Right') && hf.includes('2/3'));
  assert.equal((await run(['bates', pdf, '--prefix', 'X-', '--digits', '4', '--font', 'Courier-Bold', '-o', o('ba.pdf')])).code, 0);
  assert.ok((await wordsOf(o('ba.pdf'))).includes('X-0003'));
});

test('meta sets fields; bookmarks prints the outline', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  assert.equal((await run(['meta', pdf, '--title', 'Renamed', '--keywords', 'a, b', '-o', o('me.pdf')])).code, 0);
  assert.equal((await inspect(await readFile(o('me.pdf')))).metadata.title, 'Renamed');
  assert.match((await run(['meta', pdf])).err, /needs --title/);
  assert.equal((await run(['bookmarks', pdf])).out, 'No bookmarks.\n');
  await writeFile(o('bm.pdf'), await setBookmarks(await readFile(pdf), [{ title: 'Part 1', page: 1, children: [{ title: 'Intro', page: 2 }] }, { title: 'Notes' }]));
  assert.equal((await run(['bookmarks', o('bm.pdf')])).out, 'Part 1  (page 1)\n  Intro  (page 2)\nNotes\n');
  assert.deepEqual(JSON.parse((await run(['bookmarks', o('bm.pdf'), '--json'])).out), await getBookmarks(await readFile(o('bm.pdf'))));
});

test('encrypt and decrypt', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  assert.equal((await run(['encrypt', pdf, '--user-password', 'u', '--owner-password', 'o', '--no-copy', '--no-print', '--no-modify', '--no-annotate', '-o', o('en.pdf')])).code, 0);
  assert.match((await run(['info', o('en.pdf')])).err, /password is missing or wrong/);
  assert.match((await run(['info', o('en.pdf'), '--password', 'u'])).out, /^Encrypted\s+yes$/m);
  assert.match((await run(['decrypt', o('en.pdf'), '--password', 'u', '-o', o('de.pdf')])).err, /owner password/);
  assert.equal((await run(['decrypt', o('en.pdf'), '--password', 'o', '-o', o('de.pdf')])).code, 0);
  assert.match((await run(['info', o('de.pdf')])).out, /^Encrypted\s+no$/m);
});

test('images makes a pdf from photos', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  await writeFile(o('a.png'), pngImage({ width: 200, height: 100 }));
  await writeFile(o('b.jpg'), jpegImage({ width: 100, height: 200 }));
  const { code, out } = await run(['images', o('a.png'), o('b.jpg'), '--page-size', 'a4', '--margin', '20', '-o', o('im.pdf')]);
  assert.equal(code, 0);
  assert.match(out, /im\.pdf {2}2 pages/);
  assert.match((await run(['images'])).err, /needs one or more JPEG or PNG/);
});

test('render --pages writes one png per page', async () => {
  const { code, out } = await run(['render', pdf, '--pages', '2-3', '--width', '50', '-o', dir]);
  assert.equal(code, 0);
  assert.match(out, /sample-2\.png {2}50 x 39\n.*sample-3\.png {2}50 x 65\n/s);
});

test('edit commands explain what they need', async () => {
  assert.match((await run(['watermark', pdf])).err, /needs --text/);
  assert.match((await run(['stamp', pdf, '--text', 'x', '--at', '5'])).err, /x,y/);
  assert.match((await run(['numbers', pdf, '--size', 'big'])).err, /--size must be a number/);
  assert.match((await run(['numbers', pdf, '--start', 'one'])).err, /--start must be a whole number/);
});

test('convert turns images into pdfs, and explains what it needs', async () => {
  const o = (/** @type {string} */ name) => join(dir, name);
  await writeFile(o('photo.png'), pngImage({ width: 100, height: 50 }));
  const { code, out } = await run(['convert', o('photo.png'), '-o', o('photo.pdf')]);
  assert.equal(code, 0);
  assert.match(out, /photo\.pdf {2}1 page/);
  assert.match((await run(['convert'])).err, /one file, or --url/);
  assert.match((await run(['convert', o('photo.png'), '--url', 'https://example.com'])).err, /one file, or --url/);
  assert.match((await run(['convert', pdf, '-o', pdf])).err, /Not writing over/);
  await writeFile(o('mystery.bin'), new Uint8Array([0, 1, 2, 0]));
  assert.match((await run(['convert', o('mystery.bin')])).err, /not recognised/);
});

test('convert --url refuses private addresses', async () => {
  const { code, err } = await run(['convert', '--url', 'http://127.0.0.1/', '-o', join(dir, 'u.pdf')]);
  assert.equal(code, 1);
  assert.match(err, /error: (Not allowed to reach 127\.0\.0\.1|Chromium is not installed)/);
});

test('compress, linearize and repair', async (t) => {
  const { findQpdf } = await import('@open-documents/node');
  if (!(await findQpdf())) return t.skip('qpdf is not installed');
  const o = (/** @type {string} */ name) => join(dir, name);
  assert.match((await run(['compress', pdf, '-o', o('c.pdf')])).out, /c\.pdf {2}3 pages/);
  assert.match((await run(['linearize', pdf, '-o', o('l.pdf')])).out, /l\.pdf {2}3 pages/);
  assert.match((await run(['repair', pdf, '-o', o('r2.pdf')])).out, /r2\.pdf {2}3 pages/);
});
