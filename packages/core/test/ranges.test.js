import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRanges } from '../src/index.js';

test('single pages, ranges and open ends', () => {
  assert.deepEqual(pageRanges('1', 10), [1]);
  assert.deepEqual(pageRanges('1-3,5', 10), [1, 2, 3, 5]);
  assert.deepEqual(pageRanges('8-', 10), [8, 9, 10]);
  assert.deepEqual(pageRanges('-2', 10), [1, 2]);
  assert.deepEqual(pageRanges(' 2 - 3 , 9 ', 10), [2, 3, 9]);
});

test('backwards ranges and repeats are kept, in order', () => {
  assert.deepEqual(pageRanges('3-1', 5), [3, 2, 1]);
  assert.deepEqual(pageRanges('1,1,2', 5), [1, 1, 2]);
});

test('"last" stands for the last page', () => {
  assert.deepEqual(pageRanges('last', 7), [7]);
  assert.deepEqual(pageRanges('5-last', 7), [5, 6, 7]);
  assert.deepEqual(pageRanges('last-6', 7), [7, 6]);
});

test('"all", "odd" and "even"', () => {
  assert.deepEqual(pageRanges('all', 3), [1, 2, 3]);
  assert.deepEqual(pageRanges('odd', 5), [1, 3, 5]);
  assert.deepEqual(pageRanges('even', 5), [2, 4]);
});

test('pages outside the document are refused', () => {
  assert.throws(() => pageRanges('0', 3), { code: 'PAGE_NOT_FOUND' });
  assert.throws(() => pageRanges('2-4', 3), { code: 'PAGE_NOT_FOUND' });
});

test('nonsense is refused', () => {
  for (const spec of ['', ',', 'a', '1-2-3', '1.5', '-', '1,,2']) {
    assert.throws(() => pageRanges(spec, 3), { code: 'INVALID_OPTION' }, JSON.stringify(spec));
  }
  assert.throws(() => pageRanges(/** @type {any} */ (3), 3), { code: 'INVALID_OPTION' });
});
