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

test('overlay puts a layer on the pages', async () => {
  const layer = join(dir, 'layer.pdf');
  await writeFile(layer, (await textDocument({ pages: 1, lines: () => ['LETTERHEAD'] })).bytes);
  const out = join(dir, 'with-layer.pdf');
  const { code } = await run(['overlay', pdf, '--layer', layer, '--pages', '1', '-o', out]);
  assert.equal(code, 0);
  const [one, two] = await extractText(await readFile(out));
  assert.match(one.text, /LETTERHEAD/);
  assert.doesNotMatch(two.text, /LETTERHEAD/);
  const missing = await run(['overlay', pdf]);
  assert.deepEqual([missing.code, missing.err], [1, 'error: opendocs overlay needs --layer.\n']);
});

test('ocr makes a scan searchable and says what it did with each page', async () => {
  const { renderPages, imagesToPdf, merge } = await import('@open-documents/core');
  const original = await textDocument({ pages: 1 });
  const scanned = await imagesToPdf((await renderPages(original.bytes, { dpi: 200 })).map((p) => p.data), { pageSize: 'fit', dpi: 200 });
  const file = join(dir, 'scan.pdf');
  await writeFile(file, await merge([scanned, original.bytes]));
  const out = join(dir, 'scan-searchable.pdf');
  const { code, out: said } = await run(['ocr', file, '--lang', 'eng', '-o', out]);
  assert.equal(code, 0);
  assert.match(said, /^page 1: read, \d+% sure$/m);
  assert.match(said, /^page 2: has text already, left alone$/m);
  assert.match((await extractText(await readFile(out)))[0].text, /quick brown fox/);

  const json = await run(['ocr', file, '--json', '--pages', '1', '--dpi', '150']);
  assert.equal(json.code, 0);
  assert.ok(JSON.parse(json.out)[0].words.some((/** @type {{ text: string }} */ w) => w.text === 'fox'));

  const unknown = await run(['ocr', file, '--lang', 'klingon']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /@tesseract\.js-data\/klingon/);
});

test('to-docx and to-pptx write office files', async () => {
  const { unzipSync } = await import('fflate');
  const word = await run(['to-docx', pdf, '-o', join(dir, 'sample.docx')]);
  assert.equal(word.code, 0);
  assert.equal(word.out, `${join(dir, 'sample.docx')}\n`);
  assert.ok(unzipSync(await readFile(join(dir, 'sample.docx')))['word/document.xml']);
  const slides = await run(['to-pptx', pdf, '--no-background', '--pages', '1-2', '-o', join(dir, 'two.pptx')]);
  assert.equal(slides.code, 0);
  const entries = Object.keys(unzipSync(await readFile(join(dir, 'two.pptx'))));
  assert.ok(entries.includes('ppt/slides/slide2.xml') && !entries.includes('ppt/slides/slide3.xml'));
});

test('to-markdown prints, to-xlsx writes a workbook', { skip: await doclingMissing() }, async () => {
  const { reportDocument } = await import('@open-documents/fixtures');
  const report = join(dir, 'report.pdf');
  await writeFile(report, (await reportDocument()).bytes);
  const md = await run(['to-markdown', report, '--pages', '1']);
  assert.equal(md.code, 0);
  assert.match(md.out, /^## Quarterly Report$/m);
  const xlsx = await run(['to-xlsx', report, '-o', join(dir, 'tables.xlsx')]);
  assert.deepEqual([xlsx.code, xlsx.out], [0, `${join(dir, 'tables.xlsx')}\n`]);
  const json = await run(['to-json', report, '-o', join(dir, 'report.json')]);
  assert.equal(json.code, 0);
  assert.equal(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).tables.length, 1);
  const none = await run(['to-xlsx', report, '--pages', '2', '-o', join(dir, 'none.xlsx')]);
  assert.deepEqual([none.code, none.err], [1, 'error: No tables were found in the document.\n']);
});

/** Why the Docling tests cannot run here, or false when they can. */
async function doclingMissing() {
  const { findPython, doclingModels } = await import('@open-documents/node');
  const { existsSync } = await import('node:fs');
  return findPython() && existsSync(doclingModels()) ? false : 'Docling is not set up';
}

test('fields, fill, add-fields and flatten', async () => {
  const { formDocument } = await import('@open-documents/fixtures');
  const file = join(dir, 'form.pdf');
  await writeFile(file, (await formDocument()).bytes);
  const listed = await run(['fields', file]);
  assert.equal(listed.code, 0);
  assert.match(listed.out, /^colour\s+dropdown\s+green\s+\(options: red, green, blue\)$/m);
  assert.match(listed.out, /^agree\s+checkbox\s+true$/m);
  await writeFile(join(dir, 'values.json'), JSON.stringify({ name: 'From The CLI', agree: false }));
  const filled = join(dir, 'filled.pdf');
  assert.equal((await run(['fill', file, '--values', join(dir, 'values.json'), '--flatten', '-o', filled])).code, 0);
  assert.match((await extractText(await readFile(filled)))[0].text, /From The CLI/);
  await writeFile(join(dir, 'new-fields.json'), JSON.stringify([{ type: 'text', name: 'extra', page: 1, x: 300, y: 500, width: 120, height: 20, value: 'Hi' }]));
  const more = join(dir, 'more.pdf');
  assert.equal((await run(['add-fields', file, '--fields', join(dir, 'new-fields.json'), '-o', more])).code, 0);
  const json = await run(['fields', more, '--json']);
  assert.equal(JSON.parse(json.out).length, 5);
  assert.equal((await run(['flatten', more, '-o', join(dir, 'flat.pdf')])).code, 0);
  assert.equal((await run(['fields', join(dir, 'flat.pdf')])).out, 'No form fields.\n');
  await writeFile(join(dir, 'broken.json'), '{ not json');
  assert.deepEqual(await run(['fill', file, '--values', join(dir, 'broken.json')]), { code: 1, out: '', err: `error: ${join(dir, 'broken.json')} is not valid JSON.\n` });
});

test('compare lists the changes, or writes a side-by-side report', async () => {
  const a = join(dir, 'lease-a.pdf');
  const b = join(dir, 'lease-b.pdf');
  await writeFile(a, (await textDocument({ pages: 1, lines: () => ['The tenant pays 1200 dollars.', 'Pets are not allowed.'] })).bytes);
  await writeFile(b, (await textDocument({ pages: 1, lines: () => ['The tenant pays 1350 dollars.', 'Pets are allowed.'] })).bytes);
  const listed = await run(['compare', a, b]);
  assert.equal(listed.code, 0);
  assert.equal(listed.out, 'page 1: "1200" became "1350"\npage 1 of the first: removed "not"\n2 changes: 2 words removed, 1 added.\n');
  assert.equal((await run(['compare', a, a])).out, 'The text is the same.\n');
  assert.equal(JSON.parse((await run(['compare', a, b, '--json'])).out).changes.length, 2);
  const sheets = join(dir, 'lease-report.pdf');
  assert.equal((await run(['compare', a, b, '-o', sheets])).code, 0);
  assert.match((await extractText(await readFile(sheets)))[0].text, /lease-a\.pdf, page 1/);
  assert.equal((await run(['compare', a])).code, 2);
});

test('compress-images scales a scan down', async () => {
  const { renderPages, imagesToPdf } = await import('@open-documents/core');
  const scan = await imagesToPdf((await renderPages(await readFile(pdf), { pages: [1], dpi: 300 })).map((p) => p.data), { pageSize: 'fit', dpi: 300 });
  const file = join(dir, 'big-scan.pdf');
  await writeFile(file, scan);
  const out = join(dir, 'small-scan.pdf');
  assert.equal((await run(['compress-images', file, '--dpi', '100', '--quality', '70', '-o', out])).code, 0);
  assert.ok((await readFile(out)).length < scan.length);
});

test('pdfa fixes what it can and says what is still missing', async () => {
  const out = join(dir, 'archive.pdf');
  const fixed = await run(['pdfa', pdf, '--part', '2', '-o', out]);
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /^Says it is PDF\/A-2b\.$/m);
  assert.match(fixed.out, /^- The font Helvetica is not embedded\. \(pages 1, 2, 3\)$/m);
  const checked = await run(['pdfa', pdf, '--check']);
  assert.match(checked.out, /^Does not say it is PDF\/A\.$/m);
  assert.match(checked.out, /no PDF\/A output intent/i);
  const png = join(dir, 'picture.png');
  await writeFile(png, pngImage());
  const image = join(dir, 'picture-a.pdf');
  assert.equal((await run(['convert', png, '--pdfa', '2', '-o', image])).code, 0);
  assert.match((await run(['pdfa', image, '--check'])).out, /No common problems found/);
});

test('redact takes words, patterns and areas out, and says it checked', async () => {
  const file = join(dir, 'statement.pdf');
  await writeFile(file, (await textDocument({ pages: 1, lines: () => ['Card 4111 2222 3333 4444 for Sam Sample', 'Keep this line'] })).bytes);
  const out = join(dir, 'statement-redacted.pdf');
  const done = await run(['redact', file, '--find', 'Sam Sample', '--pattern', '\\d{4}( \\d{4}){3}', '-o', out]);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^2 boxes drawn\.$/m);
  assert.match(done.out, /^Checked: nothing redacted is left in the file\.$/m);
  assert.equal((await extractText(await readFile(out)))[0].text, 'Card for\nKeep this line');
  const checked = await run(['verify-redaction', file, '--find', 'Sam Sample']);
  assert.match(checked.out, /^- "Sam Sample" is still on page 1\.$/m);
  assert.equal((await run(['redact', file, '--area', '1,2,3', '-o', join(dir, 'x.pdf')])).code, 1);
  assert.equal((await run(['redact', file, '--pattern', '(', '-o', join(dir, 'y.pdf')])).code, 1);
});
