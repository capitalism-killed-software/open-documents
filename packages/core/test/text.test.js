import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument, splitLettersDocument } from '@open-documents/fixtures';
import { extractText, extractWords } from '../src/index.js';

const doc = await textDocument({ pages: 3, rotation: [0, 90, 0] });

test('text of every page matches what was written', async () => {
  const pages = await extractText(doc.bytes);
  assert.equal(pages.length, 3);
  pages.forEach((p, i) => {
    assert.equal(p.page, i + 1);
    assert.equal(p.text, doc.truth.pages[i].lines.join('\n'));
  });
});

test('only the pages asked for, in the order asked', async () => {
  const pages = await extractText(doc.bytes, { pages: [3, 1] });
  assert.deepEqual(pages.map((p) => p.page), [3, 1]);
  await assert.rejects(extractText(doc.bytes, { pages: [4] }), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(extractText(doc.bytes, { pages: /** @type {any} */ (2) }), { code: 'INVALID_OPTION' });
  assert.deepEqual((await extractText(doc.bytes, { pages: '2-last' })).map((p) => p.page), [2, 3]);
});

test('an empty page has no text and no words', async () => {
  const blank = await textDocument({ pages: 1, lines: () => [] });
  assert.deepEqual(await extractText(blank.bytes), [{ page: 1, text: '' }]);
  assert.deepEqual((await extractWords(blank.bytes))[0].words, []);
});

test('words come back in reading order with boxes where they were drawn', async () => {
  const [first] = await extractWords(doc.bytes, { pages: [1] });
  assert.equal(first.width, 612);
  assert.equal(first.height, 792);
  const expected = doc.truth.pages[0].lines.join(' ').split(' ');
  assert.deepEqual(first.words.map((w) => w.text), expected);

  const page = first.words[0];
  assert.equal(page.text, 'Page');
  // drawn at x = 72, baseline 72pt below the top edge, 12pt Helvetica
  assert.ok(Math.abs(page.x - 72) < 1.5, `x was ${page.x}`);
  assert.ok(page.y > 60 && page.y < 72, `y was ${page.y}`);
  const bottom = page.y + page.height;
  assert.ok(bottom > 72 && bottom < 76, `the g hangs just below the baseline, bottom was ${bottom}`);
  assert.ok(page.width > 20 && page.width < 35, `width was ${page.width}`);

  const second = first.words[4];
  assert.equal(second.text, 'The');
  assert.ok(second.y > page.y + 12, 'the second line is lower down');
});

test('text on turned pages keeps the order it was written in', async () => {
  for (const rotation of [90, 180, 270]) {
    const turned = await textDocument({ pages: 1, rotation });
    const [page] = await extractText(turned.bytes);
    assert.equal(page.text, turned.truth.pages[0].lines.join('\n'), `rotation ${rotation}`);
    const [words] = await extractWords(turned.bytes);
    assert.equal(words.words[0].text, 'Page', `rotation ${rotation}`);
  }
});

test('boxes follow the page rotation', async () => {
  const [turned] = await extractWords(doc.bytes, { pages: [2] });
  assert.equal(turned.width, 792);
  assert.equal(turned.height, 612);
  const word = turned.words[0];
  // turned a quarter clockwise, the top-left corner of the text moves to the top right
  assert.ok(word.x > 700 && word.x < 735, `x was ${word.x}`);
  assert.ok(Math.abs(word.y - 72) < 1.5, `y was ${word.y}`);
  assert.ok(word.height > word.width, 'the word now runs down the page');
  for (const w of turned.words) {
    assert.ok(w.x >= 0 && w.x + w.width <= turned.width);
    assert.ok(w.y >= 0 && w.y + w.height <= turned.height);
  }
});

test('encrypted files give up their text with the password', async () => {
  const locked = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  await assert.rejects(extractText(locked.bytes), { code: 'PASSWORD_REQUIRED' });
  const [page] = await extractText(locked.bytes, { password: 'open' });
  assert.equal(page.text, locked.truth.pages[0].lines.join('\n'));
});

test('letters written one by one on a baseline still make a word', async () => {
  const split = await splitLettersDocument('Notes');
  assert.equal((await extractText(split.bytes))[0].text, 'Notes');
  const [{ words }] = await extractWords(split.bytes);
  assert.equal(words.length, 1);
  assert.equal(words[0].text, 'Notes');
  assert.ok(Math.abs(words[0].x - 72) < 2 && words[0].width > 60, `spans the letters: ${JSON.stringify(words[0])}`);
});
