import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { textDocument } from '@open-documents/fixtures';
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
  assert.match((await run(['info'])).err, /needs a PDF file/);
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
