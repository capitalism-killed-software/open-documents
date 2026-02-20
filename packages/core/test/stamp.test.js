import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { addText, watermark, pageNumbers, headerFooter, bates, extractText, extractWords, renderPage, inspect } from '../src/index.js';

const doc = await textDocument({ pages: 3, rotation: [0, 90, 0] });

/**
 * @param {Uint8Array} bytes
 * @param {number} page
 * @param {string} text
 */
async function wordOn(bytes, page, text) {
  const [p] = await extractWords(bytes, { pages: [page] });
  const word = p.words.find((w) => w.text === text);
  assert.ok(word, `"${text}" is on page ${page}`);
  return { word, page: p };
}

test('addText at a point lands there, the right way up, on every rotation', async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const one = await textDocument({ pages: 1, rotation });
    const out = await addText(one.bytes, { text: 'Approved', at: { x: 100, y: 200 }, size: 20 });
    const { word } = await wordOn(out, 1, 'Approved');
    assert.ok(Math.abs(word.x - 100) < 3 && Math.abs(word.y - 200) < 3, `turned ${rotation}: at ${word.x}, ${word.y}`);
    assert.ok(word.width > word.height * 3, `turned ${rotation}: reads across the page`);
  }
});

test('the original content is still there', async () => {
  const out = await addText(doc.bytes, { text: 'Note', position: 'top-right' });
  const before = await extractText(doc.bytes);
  const after = await extractText(out);
  after.forEach((p, i) => assert.ok(p.text.startsWith(before[i].text), `page ${i + 1} keeps its text`));
});

test('positions sit inside the margin', async () => {
  const out = await addText(doc.bytes, { text: 'TL', position: 'top-left', margin: 50, size: 10, pages: [1] });
  const { word } = await wordOn(out, 1, 'TL');
  assert.ok(Math.abs(word.x - 50) < 2 && Math.abs(word.y - 50) < 3);
  const br = await addText(doc.bytes, { text: 'BR', position: 'bottom-right', margin: 50, size: 10, pages: '2' });
  const found = await wordOn(br, 2, 'BR');
  assert.ok(Math.abs(found.word.x + found.word.width - (found.page.width - 50)) < 2, 'right edge at the margin');
  assert.ok(Math.abs(found.word.y + found.word.height - (found.page.height - 50)) < 3, 'bottom edge at the margin');
});

test('watermark crosses the middle of every page, faint and slanted', async () => {
  const out = await watermark(doc.bytes, { text: 'DRAFT', color: '#ff0000' });
  for (const n of [1, 2, 3]) {
    const { word, page } = await wordOn(out, n, 'DRAFT');
    assert.ok(Math.abs(word.x + word.width / 2 - page.width / 2) < 5, 'centred across');
    assert.ok(Math.abs(word.y + word.height / 2 - page.height / 2) < 5, 'centred down');
    assert.ok(word.height > 100, 'slanted, so its box is tall');
  }
  const img = await renderPage(out, { dpi: 72, format: 'rgba' });
  const reddish = [];
  for (let x = 250; x < 360; x++) {
    const i = (396 * img.width + x) * 4;
    if (img.data[i] > 230 && img.data[i + 1] < 220 && img.data[i + 1] > 120) reddish.push(x);
  }
  assert.ok(reddish.length > 10, 'pale red pixels where the watermark crosses the middle');
});

test('page numbers count the selected pages', async () => {
  const out = await pageNumbers(doc.bytes, { format: 'Page {n} of {total}', pages: '2-3', start: 1 });
  const words = await extractWords(out);
  assert.equal(words[0].words.some((w) => w.text === 'Page' && w.y > 700), false, 'the first page is not numbered');
  for (const [n, label] of [[2, '1'], [3, '2']]) {
    const page = words[n - 1];
    const i = page.words.findIndex((w, k) => w.text === 'Page' && page.words[k + 1]?.text === label && page.words[k + 3]?.text === '2');
    assert.ok(i >= 0, `page ${n} says Page ${label} of 2`);
    assert.ok(page.words[i].y > page.height - 60, 'near the bottom');
  }
});

test('plain numbers, bottom centre, on a turned page too', async () => {
  const out = await pageNumbers(doc.bytes, { format: '[{n}]' });
  const { word, page } = await wordOn(out, 2, '[2]');
  assert.ok(Math.abs(word.x + word.width / 2 - page.width / 2) < 3);
  assert.ok(word.y > page.height - 45 && word.y < page.height - 28);
});

test('headers and footers fill their slots', async () => {
  const out = await headerFooter(doc.bytes, {
    header: { left: 'Contract', right: '{title}' },
    footer: { center: '{n} / {total}' },
    title: 'Draft-2',
  });
  const [first] = await extractWords(out, { pages: [1] });
  const contract = first.words.find((w) => w.text === 'Contract');
  const title = first.words.find((w) => w.text === 'Draft-2');
  assert.ok(contract && title && contract.x < 60 && title.x > 500 && contract.y < 40 && title.y < 40);
  const pageLine = first.words.filter((w) => w.y > 740).map((w) => w.text).join(' ');
  assert.equal(pageLine, '1 / 3');
});

test('bates numbers run on with a prefix', async () => {
  const out = await bates(doc.bytes, { prefix: 'ACME-', start: 41, digits: 5 });
  for (const [n, label] of [[1, 'ACME-00041'], [2, 'ACME-00042'], [3, 'ACME-00043']]) {
    const { word, page } = await wordOn(out, n, label);
    assert.ok(word.x > page.width / 2 && word.y > page.height - 50, `${label} at the bottom right`);
  }
});

test('stamping keeps encryption', async () => {
  const locked = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  const out = await watermark(locked.bytes, { text: 'COPY', password: 'open' });
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  assert.match((await extractText(out, { password: 'open' }))[0].text, /COPY/);
});

test('behind lets the content show through', async () => {
  // solid red letters across the first line of text, once on top and once "behind"
  const block = { text: 'MMMMMMMMMM', at: { x: 60, y: 50 }, size: 40, color: '#ff0000', pages: [1] };
  const over = await renderPage(await addText(doc.bytes, block), { dpi: 72, format: 'rgba' });
  const under = await renderPage(await addText(doc.bytes, { ...block, behind: true }), { dpi: 72, format: 'rgba' });
  let covered = 0;
  let showing = 0;
  for (let y = 60; y < 74; y++) {
    for (let x = 72; x < 140; x++) {
      const i = (y * over.width + x) * 4;
      const red = over.data[i] > 200 && over.data[i + 1] < 60;
      if (!red) continue;
      covered++;
      if (under.data[i] < 100 && under.data[i + 1] < 100) showing++;
    }
  }
  assert.ok(covered > 100, 'the red letters cover part of the line');
  assert.ok(showing > 20, `text shows through where red letters would hide it (${showing} of ${covered} pixels)`);
});

test('bad options are refused', async () => {
  const bad = [
    () => addText(doc.bytes, { text: '日本' }),
    () => addText(doc.bytes, { text: 'x', font: 'Comic Sans' }),
    () => addText(doc.bytes, { text: 'x', position: 'middle' }),
    () => addText(doc.bytes, { text: 'x', opacity: 2 }),
    () => addText(doc.bytes, { text: 'x', at: /** @type {any} */ ({ x: 1 }) }),
    () => addText(doc.bytes, { text: 'x', angle: 1000 }),
    () => addText(doc.bytes, { text: 'x', margin: -1 }),
    () => addText(doc.bytes, /** @type {any} */ ({ text: 5 })),
    () => addText(doc.bytes, /** @type {any} */ (undefined)),
    () => watermark(doc.bytes, /** @type {any} */ (undefined)),
    () => pageNumbers(doc.bytes, { start: -1 }),
    () => pageNumbers(doc.bytes, { format: /** @type {any} */ (7) }),
    () => headerFooter(doc.bytes, {}),
    () => bates(doc.bytes, { prefix: 'Ω' }),
    () => bates(doc.bytes, { digits: 2.5 }),
  ];
  for (const [i, run] of bad.entries()) await assert.rejects(run(), { code: 'INVALID_OPTION' }, `case ${i}`);
});

test('Latin punctuation the standard fonts can draw is allowed', async () => {
  const out = await addText(doc.bytes, { text: 'Café – “quoted” €5', pages: [1], at: { x: 72, y: 300 } });
  assert.match((await extractText(out, { pages: [1] }))[0].text, /Café – “quoted” €5/);
});
