import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitTextBox } from '../src/text-box.js';

const page = { width: 612, height: 792 };
// every character half the font size wide, at 14 points
const measure = (/** @type {string} */ text) => text.length * 7;
/** @param {string} contents @param {number} [width] @param {number} [height] @param {number} [x] @param {number} [y] */
const box = (contents, width = 220, height = 22, x = 100, y = 300) => ({ contents, fontSize: 14, rect: { origin: { x, y }, size: { width, height } } });

test('a text box that already holds its text stays as it is', () => {
  assert.equal(fitTextBox(box('Checked'), page, measure), null);
});

test('a box grows wider, up to the edge of the page, then taller', () => {
  const words = 'word '.repeat(30).trim();
  const fitted = fitTextBox(box(words), page, measure);
  assert.ok(fitted);
  assert.deepEqual(fitted.origin, { x: 100, y: 300 });
  assert.equal(fitted.size.width, 512, 'as far as the right edge');
  // 149 characters, 1043 points, wrap onto 3 lines of up to 508 points
  assert.equal(fitted.size.height, 3 * 14 * 1.25 + 4);
});

test('short text wider than the box widens it just enough', () => {
  // 40 characters, 280 points, and 4 points free
  const fitted = fitTextBox(box('Approved on the second visit, no changes'), page, measure);
  assert.deepEqual(fitted?.size, { width: 284, height: 22 });
});

test('each line typed counts, and a box never shrinks', () => {
  const fitted = fitTextBox(box('one\ntwo\nthree\nfour'), page, measure);
  assert.deepEqual(fitted?.size, { width: 220, height: 4 * 14 * 1.25 + 4 });
  assert.equal(fitTextBox(box('one', 300, 200), page, measure), null, 'a big box sized by hand stays');
});

test('a box near the bottom of the page grows only to the bottom', () => {
  const fitted = fitTextBox(box('a\nb\nc\nd\ne\nf', 220, 22, 100, 760), page, measure);
  assert.equal(fitted?.size.height, 32);
});
