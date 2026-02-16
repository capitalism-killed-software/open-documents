import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { textDocument } from '@open-documents/fixtures';
import { inspect, extractText } from '@open-documents/core';
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
  assert.match((await run(['crop', pdf, '--margins', 'wide'])).err, /number of points/);
  assert.match((await run(['blank', pdf])).err, /needs --at/);
});
