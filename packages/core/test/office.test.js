import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, StandardFonts, rgb, TextRenderingMode, setTextRenderingMode, pushGraphicsState, popGraphicsState } from '@cantoo/pdf-lib';
import { textDocument, pngImage, scaledDocument, SCALED_NOTICE, unlistedFontDocument, UNLISTED_FONT } from '@open-documents/fixtures';
import { toDocx, toPptx, merge } from '../src/index.js';
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

test('text drawn under a page-wide scale keeps the size it shows at', async () => {
  // statement and letter generators often draw in 300-dpi units under a 0.24 scale; the font
  // size in the content is then 41.67 for 10-point text
  const { bytes } = await scaledDocument();
  /** @param {string} xml @param {string} text */
  const runOf = (xml, text) => {
    const at = xml.indexOf(`>${text}</`);
    assert.ok(at > 0, `"${text}" is there`);
    return xml.slice(Math.max(xml.lastIndexOf('<w:r>', at), xml.lastIndexOf('<a:r>', at)), at);
  };
  const word = files(await toDocx(bytes)).text('word/document.xml');
  const slide = files(await toPptx(bytes)).text('ppt/slides/slide1.xml');
  for (const line of SCALED_NOTICE.lines) {
    assert.match(runOf(word, line.text), new RegExp(`<w:sz w:val="${line.size * 2}"/>`), `Word: "${line.text}" at ${line.size} pt`);
    assert.match(runOf(slide, line.text), new RegExp(` sz="${line.size * 100}" `), `PowerPoint: "${line.text}" at ${line.size} pt`);
  }
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
  assert.deepEqual(await toPptx(pdf), await toPptx(pdf));
});

test('pages bigger than Word allows are scaled down to fit', async () => {
  const { text } = files(await toDocx(await styled({ size: [3000, 2000] })));
  const [, w, h] = /** @type {RegExpMatchArray} */ (text('word/document.xml').match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/));
  assert.deepEqual([Number(w), Number(h)], [31680, 21120]);
});

test('pptx: one slide per page, sized by the first page, other sizes fitted in', async () => {
  const a4 = await textDocument({ pages: 1, size: 'a4' });
  const pdf = await merge([await styled({ rectangle: true }), a4.bytes]);
  const { names, text } = files(await toPptx(pdf));
  assert.ok(names.includes('ppt/slides/slide1.xml') && names.includes('ppt/slides/slide2.xml'));
  assert.ok(names.includes('ppt/media/page1.png') && !names.includes('ppt/media/page2.png'));
  assert.match(text('ppt/presentation.xml'), /<p:sldSz cx="7772400" cy="10058400"\/>/);
  assert.match(text('[Content_Types].xml'), /slide2\.xml/);
  const heading = text('ppt/slides/slide1.xml');
  assert.match(heading, /<a:rPr lang="en-US" sz="1800" b="1" i="0" dirty="0"><a:solidFill><a:srgbClr val="ff0000"\/>/);
  assert.match(text('ppt/slides/slide2.xml'), /quick brown fox/);
  assert.match(text('docProps/core.xml'), /Styled &amp; &lt;sample&gt;/);
});

test('pptx: turned text runs down its slide', async () => {
  const doc = await textDocument({ pages: 1, rotation: 270 });
  const slide = files(await toPptx(doc.bytes)).text('ppt/slides/slide1.xml');
  assert.match(slide, /vert="vert270"/);
});

test('font names from PDFs become the families office suites know', () => {
  assert.deepEqual(fontFace('ABCDEF+Calibri-BoldItalic', -1, 0), { font: 'Calibri', bold: true, italic: true, kind: 'sans' });
  assert.deepEqual(fontFace('TimesNewRomanPSMT', 400, 0), { font: 'Times New Roman', bold: false, italic: false, kind: 'serif' });
  assert.deepEqual(fontFace('SourceSansPro-Regular', 400, 0), { font: 'Source Sans Pro', bold: false, italic: false, kind: 'sans' });
  assert.deepEqual(fontFace('GaramondPremrPro', 700, 0x40), { font: 'Garamond Premr Pro', bold: true, italic: true, kind: 'serif' });
  assert.deepEqual(fontFace('', -1, 0), { font: 'Arial', bold: false, italic: false, kind: 'sans' });
});

test('a font no one has is called sans, serif or fixed width, from its flags, then its name', () => {
  // descriptor flags: 1 fixed width, 2 serif, 0x20 not symbolic (says nothing about the look)
  assert.equal(fontFace('Unlisted_Sample_Face', 400, 0).kind, 'sans');
  assert.equal(fontFace('Unlisted_Sample_Face', 400, 0x20).kind, 'sans');
  assert.equal(fontFace('Unlisted_Sample_Face', 400, 0x22).kind, 'serif');
  assert.equal(fontFace('Unlisted_Sample_Face', 400, 0x21).kind, 'mono');
  assert.equal(fontFace('ABCDEF+SourceCodePro-Regular', 400, 0).kind, 'mono');
  assert.equal(fontFace('PTSerif-Bold', 700, 0).kind, 'serif');
  assert.equal(fontFace('Georgia', 400, 0).kind, 'serif');
  assert.equal(fontFace('MicrosoftSansSerif', 400, 0).kind, 'sans');
  assert.equal(fontFace('Helvetica', 400, 0x22).kind, 'sans', 'a family we know keeps its own kind');
});

test('Word and PowerPoint say what kind each font is, for readers that lack it', async () => {
  const bytes = await styled();
  const word = files(await toDocx(bytes));
  const table = word.text('word/fontTable.xml');
  assert.match(table, /<w:font w:name="Arial"><w:family w:val="swiss"\/><w:pitch w:val="variable"\/><\/w:font>/);
  assert.match(table, /<w:font w:name="Times New Roman"><w:family w:val="roman"\/><w:pitch w:val="variable"\/><\/w:font>/);
  assert.match(table, /<w:font w:name="Courier New"><w:family w:val="modern"\/><w:pitch w:val="fixed"\/><\/w:font>/);
  assert.equal(table.match(/<w:font /g)?.length, 3, 'each family once');
  assert.match(word.text('word/_rels/document.xml.rels'), /relationships\/fontTable" Target="fontTable\.xml"/);
  assert.match(word.text('[Content_Types].xml'), /PartName="\/word\/fontTable\.xml" ContentType="[^"]+fontTable\+xml"/);

  const slide = files(await toPptx(bytes)).text('ppt/slides/slide1.xml');
  assert.match(slide, /<a:latin typeface="Arial" pitchFamily="34"\/>/);
  assert.match(slide, /<a:latin typeface="Times New Roman" pitchFamily="18"\/>/);
  assert.match(slide, /<a:latin typeface="Courier New" pitchFamily="49"\/>/);
});

test('a font no one has keeps its name, and Word is told it is a sans', async () => {
  const { bytes } = await unlistedFontDocument();
  const word = files(await toDocx(bytes));
  assert.match(word.text('word/document.xml'), new RegExp(`w:ascii="${UNLISTED_FONT}"`));
  assert.match(word.text('word/fontTable.xml'), new RegExp(`<w:font w:name="${UNLISTED_FONT}"><w:family w:val="swiss"/>`));
});

test('bad options are refused', async () => {
  const doc = await textDocument({ pages: 1 });
  await assert.rejects(toDocx(doc.bytes, { background: /** @type {any} */ ('sometimes') }), { code: 'INVALID_OPTION' });
  await assert.rejects(toDocx(doc.bytes, { dpi: 1000 }), { code: 'INVALID_OPTION' });
  await assert.rejects(toPptx(doc.bytes, { pages: [] }), { code: 'INVALID_OPTION', message: /No pages/ });
  await assert.rejects(toDocx(new Uint8Array([1])), { code: 'INVALID_INPUT' });
});
