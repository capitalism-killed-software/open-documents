import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { compareText, compareVisual, compareReport, extractText, inspect, extractWords, encrypt } from '../src/index.js';
import { diffWords } from '../src/diff.js';

const BEFORE = ['Lease agreement', 'The tenant pays 1200 dollars each month.', 'The landlord repairs the roof.', 'Pets are not allowed.'];
const AFTER = ['Lease agreement', 'The tenant pays 1350 dollars each month, due on the first.', 'The landlord repairs the roof.', 'Pets are allowed with a deposit.'];
const SIGN = ['Signatures', 'Both parties sign below.'];
const a = (await textDocument({ pages: 2, lines: (n) => (n === 1 ? BEFORE : SIGN) })).bytes;
const b = (await textDocument({ pages: 2, lines: (n) => (n === 1 ? AFTER : SIGN) })).bytes;

/** @param {import('../src/diff.js').Run[]} runs @param {string[]} x @param {string[]} y */
function rebuild(runs, x, y) {
  return runs.flatMap((r) => (r.type === 'removed' ? [] : (r.type === 'same' ? x.slice(r.a, r.a + r.length) : y.slice(r.b, r.b + r.length))));
}

test('the word diff always rebuilds the second list from the first', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const vocabulary = 'the a cat sat on mat dog ran fast slow red blue one two'.split(' ');
  for (let round = 0; round < 300; round++) {
    const x = Array.from({ length: Math.floor(random() * 40) }, () => vocabulary[Math.floor(random() * vocabulary.length)]);
    const y = x.filter(() => random() > 0.2).flatMap((w) => (random() > 0.85 ? [w, vocabulary[Math.floor(random() * vocabulary.length)]] : [w]));
    const runs = diffWords(x, y);
    assert.deepEqual(rebuild(runs, x, y), y);
    const kept = runs.filter((r) => r.type !== 'added').reduce((n, r) => n + r.length, 0);
    assert.equal(kept, x.length, 'every word of the first list is kept or removed once');
  }
  assert.deepEqual(diffWords([], []), []);
  assert.deepEqual(diffWords(['a'], []), [{ type: 'removed', a: 0, b: 0, length: 1 }]);
});

test('a long stretch with no common words is replaced, not matched cell by cell', () => {
  const x = Array.from({ length: 3000 }, (_, i) => `x${i % 7}`);
  const y = Array.from({ length: 3000 }, (_, i) => `y${i % 7}`);
  const runs = diffWords(x, y);
  assert.deepEqual(runs.map((r) => [r.type, r.length]), [['removed', 3000], ['added', 3000]]);
});

test('compareText finds what was changed, added and removed, with where each word is', async () => {
  const result = await compareText(a, b);
  assert.equal(result.identical, false);
  assert.deepEqual(result.changes.map((c) => [c.type, c.before, c.after]), [
    ['changed', '1200', '1350'],
    ['added', '', 'due on the first.'],
    ['removed', 'not', ''],
    ['added', '', 'with a deposit.'],
  ]);
  assert.deepEqual(result.words, { removed: 2, added: 8 });
  const [first] = result.changes;
  const [page] = await extractWords(a, { pages: [1] });
  const truth = page.words.find((w) => w.text === '1200');
  assert.deepEqual(first.beforeWords, [{ ...truth, page: 1 }]);
  assert.equal(first.afterWords[0].page, 1);
});

test('exact compares words as written; ignoreCase ignores case', async () => {
  const exact = await compareText(a, b, { exact: true });
  assert.deepEqual(exact.changes.map((c) => c.type), ['changed', 'changed', 'changed']);
  const lower = (await textDocument({ pages: 1, lines: () => ['lease AGREEMENT'] })).bytes;
  const upper = (await textDocument({ pages: 1, lines: () => ['Lease agreement'] })).bytes;
  assert.equal((await compareText(lower, upper)).identical, false);
  assert.equal((await compareText(lower, upper, { ignoreCase: true })).identical, true);
});

test('text that only moved to another page is not a change', async () => {
  const onePage = (await textDocument({ pages: 1, lines: () => [...BEFORE, ...SIGN] })).bytes;
  const twoPages = (await textDocument({ pages: 2, lines: (n) => (n === 1 ? BEFORE : SIGN) })).bytes;
  const { identical, changes } = await compareText(onePage, twoPages);
  assert.ok(identical, JSON.stringify(changes));
});

test('the same document is identical to itself, encrypted or not', async () => {
  const locked = await encrypt(a, { userPassword: 'pw' });
  assert.equal((await compareText(a, locked, { passwordB: 'pw' })).identical, true);
  await assert.rejects(compareText(a, locked), { code: 'PASSWORD_REQUIRED' });
});

test('compareVisual says how much of each page changed, and can show where', async () => {
  const pages = await compareVisual(a, b, { images: true });
  assert.equal(pages.length, 2);
  assert.ok(pages[0].changed > 0 && pages[0].changed < 0.05, String(pages[0].changed));
  assert.equal(pages[1].changed, 0);
  assert.deepEqual([...(/** @type {Uint8Array} */ (pages[0].image)).subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const shorter = (await textDocument({ pages: 1, lines: () => BEFORE })).bytes;
  const uneven = await compareVisual(a, shorter);
  assert.deepEqual(uneven.map((p) => [p.changed, p.sameSize]), [[0, true], [1, false]]);
  assert.equal(uneven[0].image, undefined);
  const a4 = (await textDocument({ pages: 1, size: 'a4', lines: () => BEFORE })).bytes;
  assert.deepEqual((await compareVisual(shorter, a4)).map((p) => p.sameSize), [false]);
  await assert.rejects(compareVisual(a, b, { dpi: 1000 }), { code: 'INVALID_OPTION' });
});

test('compareReport shows both versions side by side, page by page', async () => {
  const report = await compareReport(a, b, { labels: ['Draft', 'Signed'] });
  const info = await inspect(report);
  assert.equal(info.pageCount, 2);
  assert.ok(info.pages[0].width > 2 * 612, 'two pages fit across');
  const [one] = await extractText(report);
  assert.match(one.text, /Draft, page 1/);
  assert.match(one.text, /Signed, page 1/);
  assert.match(one.text, /1200/);
  assert.match(one.text, /1350/);
  const longer = (await textDocument({ pages: 3, lines: (n) => (n === 1 ? BEFORE : SIGN) })).bytes;
  const uneven = await compareReport(a, longer);
  assert.equal((await inspect(uneven)).pageCount, 3);
  assert.match((await extractText(uneven))[2].text, /No such page in this version/);
  await assert.rejects(compareReport(a, b, { labels: /** @type {any} */ ([1, 2]) }), { code: 'INVALID_OPTION' });
});

test('turned pages are shown the way they are seen', async () => {
  const turned = (await textDocument({ pages: 1, rotation: 90, lines: () => BEFORE })).bytes;
  const report = await compareReport(turned, turned);
  const [page] = await extractWords(report);
  const lease = page.words.find((w) => w.text === 'Lease');
  assert.ok(lease && lease.height > lease.width, 'the text reads down the page, as on the turned page');
});
