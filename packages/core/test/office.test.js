import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, StandardFonts, rgb, TextRenderingMode, setTextRenderingMode, pushGraphicsState, popGraphicsState } from '@cantoo/pdf-lib';
import { textDocument, pngImage } from '@open-documents/fixtures';
import { toDocx } from '../src/index.js';
import { fontFace } from '../src/convert/layout.js';

/** @param {Uint8Array} zip */
function files(zip) {
  const all = unzipSync(zip);
  return { names: Object.keys(all).sort(), text: (/** @type {string} */ name) => strFromU8(all[name]) };
}

/**
 * A page with styled text, a rectangle, words far apart, and characters XML must escape.
 *
 * @param {{ rectangle?: boolean, invisible?: boolean, size?: [number, number] }} [options]
 */
async function styled(options = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('Styled & <sample>');
  doc.setAuthor('A Writer');
  const [width, height] = options.size ?? [612, 792];
  const page = doc.addPage([width, height]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const mono = await doc.embedFont(StandardFonts.Courier);
  if (options.rectangle) page.drawRectangle({ x: 60, y: height - 300, width: 200, height: 100, color: rgb(0.2, 0.4, 0.8) });
  if (options.invisible) {
    page.drawImage(await doc.embedPng(pngImage()), { x: 0, y: 0, width, height });
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
  }
  page.drawText('Heading', { x: 72, y: height - 80, size: 18, font: bold, color: rgb(1, 0, 0) });
  page.drawText('A quote, set in italics', { x: 72, y: height - 110, size: 11, font: italic });
  page.drawText('Name', { x: 72, y: height - 140, size: 10, font: mono });
  page.drawText('Amount', { x: 400, y: height - 140, size: 10, font: mono });
  page.drawText('Fish & chips <large>', { x: 72, y: height - 160, size: 10, font: mono });
  if (options.invisible) page.pushOperators(popGraphicsState());
  return doc.save();
}

test('every page becomes a section of its own size; a turned page is landscape', async () => {
  const doc = await textDocument({ pages: 2, rotation: [0, 90] });
  const { text } = files(await toDocx(doc.bytes));
  const sections = [...text('word/document.xml').matchAll(/<w:pgSz ([^/]*)\/>/g)].map((m) => m[1]);
  assert.deepEqual(sections, ['w:w="12240" w:h="15840"', 'w:w="15840" w:h="12240" w:orient="landscape"']);
  assert.match(text('word/document.xml'), /The quick brown fox jumps over the lazy dog\./);
  assert.match(text('word/document.xml'), /vert="vert"/, 'text on the turned page runs down it');
});

test('text keeps its font, size, weight, slant and colour', async () => {
  const xml = files(await toDocx(await styled())).text('word/document.xml');
  /** @param {string} words */
  const runOf = (words) => {
    const at = xml.indexOf(`>${words}</w:t>`);
    assert.ok(at > 0, `"${words}" is there`);
    return xml.slice(xml.lastIndexOf('<w:r>', at), at);
  };
  const heading = runOf('Heading');
  assert.match(heading, /w:ascii="Arial"/);
  assert.match(heading, /<w:b\/>/);
  assert.match(heading, /<w:color w:val="ff0000"\/>/);
  assert.match(heading, /<w:sz w:val="36"\/>/);
  const quote = runOf('A quote, set in italics');
  assert.match(quote, /w:ascii="Times New Roman"/);
  assert.match(quote, /<w:i\/>/);
  assert.doesNotMatch(quote, /<w:b\/>/);
  assert.match(runOf('Name'), /w:ascii="Courier New"/);
});

test('words far apart on one line stay in separate boxes, where they were', async () => {
  const xml = files(await toDocx(await styled())).text('word/document.xml');
  assert.ok(xml.includes('>Name</w:t>') && xml.includes('>Amount</w:t>'), 'not joined into one line of text');
  const boxes = (xml.match(/<wps:wsp>/g) ?? []).length;
  assert.equal(boxes, 5);
});

test('characters XML cannot hold as they are are escaped', async () => {
  const { text } = files(await toDocx(await styled()));
  assert.match(text('word/document.xml'), />Fish &amp; chips &lt;large&gt;<\/w:t>/);
  assert.match(text('docProps/core.xml'), /<dc:title>Styled &amp; &lt;sample&gt;<\/dc:title><dc:creator>A Writer<\/dc:creator>/);
});

test('what is not text becomes one picture behind the text, unless there is none or it is turned off', async () => {
  const drawn = files(await toDocx(await styled({ rectangle: true })));
  assert.ok(drawn.names.includes('word/media/page1.png'));
  assert.match(drawn.text('word/document.xml'), /behindDoc="1"/);
  assert.match(drawn.text('word/_rels/document.xml.rels'), /Target="media\/page1.png"/);
  const plain = files(await toDocx(await styled()));
  assert.ok(!plain.names.some((n) => n.startsWith('word/media/')), 'a page of text only needs no picture');
  const off = files(await toDocx(await styled({ rectangle: true }), { background: false }));
  assert.ok(!off.names.some((n) => n.startsWith('word/media/')));
});

test('a scan with a text layer gets its words, and the picture only when asked', async () => {
  const scan = await styled({ invisible: true });
  const auto = files(await toDocx(scan));
  assert.match(auto.text('word/document.xml'), />Heading<\/w:t>/);
  assert.ok(!auto.names.some((n) => n.startsWith('word/media/')), 'the picture would show every word twice');
  const kept = files(await toDocx(scan, { background: true, dpi: 72 }));
  assert.ok(kept.names.includes('word/media/page1.png'));
});

test('the same file always gives the same bytes', async () => {
  const pdf = await styled({ rectangle: true });
  assert.deepEqual(await toDocx(pdf), await toDocx(pdf));
});

test('pages bigger than Word allows are scaled down to fit', async () => {
  const { text } = files(await toDocx(await styled({ size: [3000, 2000] })));
  const [, w, h] = /** @type {RegExpMatchArray} */ (text('word/document.xml').match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/));
  assert.deepEqual([Number(w), Number(h)], [31680, 21120]);
});



test('font names from PDFs become the families office suites know', () => {
  assert.deepEqual(fontFace('ABCDEF+Calibri-BoldItalic', -1, 0), { font: 'Calibri', bold: true, italic: true });
  assert.deepEqual(fontFace('TimesNewRomanPSMT', 400, 0), { font: 'Times New Roman', bold: false, italic: false });
  assert.deepEqual(fontFace('SourceSansPro-Regular', 400, 0), { font: 'Source Sans Pro', bold: false, italic: false });
  assert.deepEqual(fontFace('GaramondPremrPro', 700, 0x40), { font: 'Garamond Premr Pro', bold: true, italic: true });
  assert.deepEqual(fontFace('', -1, 0), { font: 'Arial', bold: false, italic: false });
});

test('bad options are refused', async () => {
  const doc = await textDocument({ pages: 1 });
  await assert.rejects(toDocx(doc.bytes, { background: /** @type {any} */ ('sometimes') }), { code: 'INVALID_OPTION' });
  await assert.rejects(toDocx(doc.bytes, { dpi: 1000 }), { code: 'INVALID_OPTION' });
  await assert.rejects(toDocx(doc.bytes, { pages: [] }), { code: 'INVALID_OPTION', message: /No pages/ });
  await assert.rejects(toDocx(new Uint8Array([1])), { code: 'INVALID_INPUT' });
});
