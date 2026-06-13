import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { textDocument } from '@open-documents/fixtures';
import { overlay, extractText, extractWords, renderPage, inspect } from '../src/index.js';

/**
 * A layer: one page per entry, each with words drawn at points measured from the top left.
 *
 * @param {{ size?: [number, number], words?: { text: string, x: number, y: number }[], fill?: boolean }[]} pages
 */
async function layer(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const [width, height] = spec.size ?? [612, 792];
    const page = doc.addPage([width, height]);
    if (spec.fill) page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 0, 0) });
    for (const w of spec.words ?? []) page.drawText(w.text, { x: w.x, y: height - w.y - 12, size: 12, font });
  }
  return doc.save();
}

/**
 * @param {Uint8Array} bytes
 * @param {number} page
 * @param {string} text
 */
async function wordOn(bytes, page, text) {
  const [p] = await extractWords(bytes, { pages: [page] });
  const word = p.words.find((w) => w.text === text);
  assert.ok(word, `"${text}" is on page ${page}`);
  return word;
}

/** @param {{ data: Uint8Array }} image */
function dark(image) {
  let n = 0;
  for (let i = 0; i < image.data.length; i += 4) if (image.data[i] < 80 && image.data[i + 1] < 80) n++;
  return n;
}

test('a one-page layer goes on every page, over what is there', async () => {
  const doc = await textDocument({ pages: 3 });
  const out = await overlay(doc.bytes, await layer([{ words: [{ text: 'LETTERHEAD', x: 40, y: 20 }] }]));
  const pages = await extractText(out);
  assert.equal(pages.length, 3);
  for (const p of pages) {
    assert.match(p.text, /LETTERHEAD/);
    assert.match(p.text, /quick brown fox/);
  }
  assert.equal((await inspect(out)).metadata.title, 'Fixture');
});

test('a layer with one page for each selected page is used in order', async () => {
  const doc = await textDocument({ pages: 3 });
  const out = await overlay(doc.bytes, await layer([{ words: [{ text: 'FIRST', x: 40, y: 20 }] }, { words: [{ text: 'SECOND', x: 40, y: 20 }] }]), { pages: [1, 3] });
  const [one, two, three] = await extractText(out);
  assert.match(one.text, /FIRST/);
  assert.doesNotMatch(two.text, /FIRST|SECOND/);
  assert.match(three.text, /SECOND/);
});

test('a layer with the wrong number of pages is refused', async () => {
  const doc = await textDocument({ pages: 3 });
  await assert.rejects(overlay(doc.bytes, await layer([{}, {}])), { code: 'INVALID_OPTION', message: /2 pages for 3 selected pages/ });
});

test('layer content lands where it is on the layer, the right way up on every rotation', async () => {
  const top = await layer([{ words: [{ text: 'Corner', x: 50, y: 60 }] }]);
  for (const rotation of [0, 90, 180, 270]) {
    const doc = await textDocument({ pages: 1, rotation });
    const out = await overlay(doc.bytes, top, { fit: 'stretch' });
    const word = await wordOn(out, 1, 'Corner');
    // stretched onto a page that is shown landscape, x and y scale with the page
    const [shown] = await extractWords(out);
    const sx = shown.width / 612;
    const sy = shown.height / 792;
    assert.ok(Math.abs(word.x - 50 * sx) < 4 && Math.abs(word.y - 60 * sy) < 6, `turned ${rotation}: at ${word.x}, ${word.y}`);
    assert.ok(word.width > word.height, `turned ${rotation}: reads across the page`);
  }
});

test('contain keeps the layer in proportion and centres it; stretch fills the page', async () => {
  const doc = await textDocument({ pages: 1 }); // letter, 612 x 792
  const a4 = await layer([{ size: [595, 842], words: [{ text: 'Origin', x: 0, y: 0 }] }]);
  const contained = await wordOn(await overlay(doc.bytes, a4), 1, 'Origin');
  const scale = 792 / 842;
  assert.ok(Math.abs(contained.x - (612 - 595 * scale) / 2) < 2, `centred across: ${contained.x}`);
  assert.ok(contained.y < 5, `touches the top: ${contained.y}`);
  const stretched = await wordOn(await overlay(doc.bytes, a4, { fit: 'stretch' }), 1, 'Origin');
  assert.ok(stretched.x < 2 && stretched.y < 5, `at the corner: ${stretched.x}, ${stretched.y}`);
});

test('behind puts the layer under the page content', async () => {
  const doc = await textDocument({ pages: 1 });
  const red = await layer([{ fill: true }]);
  const over = await renderPage(await overlay(doc.bytes, red), { dpi: 72, format: 'rgba' });
  const under = await renderPage(await overlay(doc.bytes, red, { behind: true }), { dpi: 72, format: 'rgba' });
  assert.equal(dark(over), 0, 'a full red page on top hides the text');
  assert.ok(dark(under) > 20, 'the text shows on the red background');
  const [p] = await extractText(await overlay(doc.bytes, red, { behind: true }));
  assert.match(p.text, /quick brown fox/);
});

test('bad layers and options are refused', async () => {
  const doc = await textDocument({ pages: 1 });
  await assert.rejects(overlay(doc.bytes, new Uint8Array([1, 2, 3])), { code: 'INVALID_INPUT' });
  await assert.rejects(overlay(doc.bytes, await layer([{}]), { fit: 'cover' }), { code: 'INVALID_OPTION' });
});
