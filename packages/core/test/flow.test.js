import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowDocument } from '@open-documents/fixtures';
import { flowBlocks } from '../src/convert/flow.js';
import { readLayout } from '../src/convert/layout.js';

/**
 * A segment as readLayout gives it, about half the size wide per character.
 *
 * @param {number} x
 * @param {number} y  baseline, from the top
 * @param {string} text
 * @param {{ size?: number, bold?: boolean, angle?: number, width?: number }} [options]
 * @returns {import('../src/convert/layout.js').Segment}
 */
function seg(x, y, text, { size = 11, bold = false, angle = 0, width } = {}) {
  return { x, y, angle, size, width: width ?? text.length * size * 0.5, runs: [{ text, font: 'Arial', kind: 'sans', bold, italic: false, size, color: '000000' }] };
}

/**
 * @param {import('../src/convert/layout.js').Segment[][]} pages
 */
function flow(...pages) {
  return flowBlocks(pages.map((segments, i) => ({ page: i + 1, width: 612, height: 792, segments, background: null })));
}

/** @param {import('../src/convert/flow.js').Block} block */
const plain = (block) => block.pieces.map((p) => ('text' in p ? p.text : 'break' in p ? '\n' : '\t')).join('');

/** @param {ReturnType<typeof flowBlocks>} result */
const texts = (result) => result.pages.flatMap((p) => p.blocks.map(plain));

// lines of about 84 characters fill a 468-point measure at 11 points
const FULL = [
  'The tenant agrees to pay the rent on the first day of each month by bank transfer to',
  'the account the landlord names in writing, and to keep the flat clean and in good order',
  'for the whole of the term.',
];

test('lines that fill the measure join into one paragraph, with spaces', () => {
  const result = flow(FULL.map((line, i) => seg(72, 100 + i * 14, line)));
  assert.deepEqual(texts(result), [FULL.join(' ')]);
  const [block] = result.pages[0].blocks;
  assert.equal(block.kind, 'paragraph');
  assert.equal(block.align, 'left');
  assert.equal(block.left, 72);
});

test('a word broken at a line end loses its hyphen; a compound keeps it', () => {
  const broken = flow([
    seg(72, 100, 'The landlord looks after the structural repairs and the regular main-'),
    seg(72, 114, 'tenance of the boiler, the wiring and the plumbing in the flat and the hall.'),
    seg(72, 128, 'and so on'),
  ]);
  assert.match(texts(broken)[0], / regular maintenance of the boiler/);
  const compound = flow([
    seg(72, 100, 'The flat was let through the agency run by the landlord and by Jean-', { width: 468 }),
    seg(72, 114, 'Paul Sample, who keeps the keys.'),
  ]);
  assert.match(texts(compound)[0], / by Jean-Paul Sample,/);
});

test('short stacked lines keep their line breaks', () => {
  const result = flow([
    seg(72, 100, 'Sam Sample'),
    seg(72, 114, 'Flat 2, 100 Example Street'),
    seg(72, 128, 'Riverton XY 00000'),
    seg(72, 160, FULL[0]),
  ]);
  assert.deepEqual(texts(result), ['Sam Sample\nFlat 2, 100 Example Street\nRiverton XY 00000', FULL[0]]);
});

test('a short page of stacked lines is not taken for a full one', () => {
  // the longest line is the right edge of the text here, but not of the page
  const result = flow([seg(72, 100, 'Sam Sample'), seg(72, 114, 'Flat 2, 100 Example Street'), seg(72, 128, 'Riverton XY 00000')]);
  assert.deepEqual(texts(result), ['Sam Sample\nFlat 2, 100 Example Street\nRiverton XY 00000']);
});

test('a wider gap, another size or another left edge starts a new paragraph', () => {
  const gap = flow([seg(72, 100, FULL[0]), seg(72, 130, FULL[1])]);
  assert.equal(gap.pages[0].blocks.length, 2);
  assert.equal(gap.pages[0].blocks[0].before, 0, 'nothing above the first');
  assert.ok(gap.pages[0].blocks[1].before > 10, 'with the space kept above it');
  const size = flow([seg(72, 100, FULL[0]), seg(72, 112, FULL[1], { size: 9 })]);
  assert.equal(size.pages[0].blocks.length, 2);
  const inset = flow([seg(72, 100, FULL[0]), seg(144, 114, 'set in by an inch, as a quote is')]);
  assert.equal(inset.pages[0].blocks.length, 2);
  assert.equal(inset.pages[0].blocks[1].left, 144);
});

test('a first line set in from the rest starts a paragraph that runs on', () => {
  const result = flow([seg(90, 100, FULL[0].slice(4)), seg(72, 114, FULL[1]), seg(72, 128, FULL[2])]);
  const [block] = result.pages[0].blocks;
  assert.equal(result.pages[0].blocks.length, 1);
  assert.equal(block.first, 90);
  assert.equal(block.left, 72);
});

test('a short line all in bold does not run into the plain text below it', () => {
  const result = flow([seg(72, 100, 'Payment details', { bold: true }), seg(72, 114, FULL[0]), seg(72, 128, FULL[1])]);
  assert.deepEqual(texts(result), ['Payment details', `${FULL[0]} ${FULL[1]}`]);
  assert.equal(result.pages[0].blocks[0].kind, 'heading');
});

test('cells on one baseline become a row, with a tab before each cell after the first', () => {
  const result = flow([
    seg(72, 100, 'Item', { bold: true }), seg(252, 100, 'Due', { bold: true }), seg(432, 100, 'Amount', { bold: true }),
    seg(72, 116, 'Rent'), seg(252, 116, 'First of the month'), seg(432, 116, '950'),
  ]);
  assert.deepEqual(texts(result), ['Item\tDue\tAmount', 'Rent\tFirst of the month\t950']);
  const [head] = result.pages[0].blocks;
  assert.equal(head.kind, 'row');
  assert.deepEqual(head.tabs, [252, 432]);
});

test('text at an angle comes after the rest of its page; nothing is dropped', () => {
  const result = flow([seg(40, 700, 'Reference 0001', { angle: 270 }), seg(72, 100, FULL[0]), seg(72, 114, FULL[1])]);
  assert.deepEqual(texts(result), [`${FULL[0]} ${FULL[1]}`, 'Reference 0001']);
});

test('headings are found by size, largest first, and by a short line in bold', () => {
  const result = flow([
    seg(72, 80, 'Tenancy Agreement', { size: 20, bold: true }),
    seg(72, 120, FULL[0]), seg(72, 134, FULL[1]), seg(72, 148, FULL[2]),
    seg(72, 180, 'Rules of the house', { size: 14, bold: true }),
    seg(72, 210, FULL[0]),
    seg(72, 240, 'Keys', { bold: true }),
    seg(72, 260, FULL[1]),
  ], [seg(72, 80, 'Notes', { size: 14, bold: true }), seg(72, 110, FULL[2])]);
  const headings = result.pages.flatMap((p) => p.blocks.filter((b) => b.kind === 'heading').map((b) => [plain(b), b.level]));
  assert.deepEqual(headings, [['Tenancy Agreement', 1], ['Rules of the house', 2], ['Keys', 3], ['Notes', 2]]);
  assert.deepEqual(result.body, { size: 11, font: 'Arial', kind: 'sans', color: '000000' });
});

test('list items keep their markers, with a tab after them; wrapped items run on', () => {
  const result = flow([
    seg(72, 100, '• Keep the shared hallway clear.'),
    seg(72, 116, '• Put rubbish out on Tuesday evenings, in the bins the council provides, and bring the', { width: 445 }),
    seg(86, 130, 'bins back in by Wednesday night.'),
    seg(72, 146, '• No pets.'),
    seg(72, 180, '1. First'), seg(72, 196, '2. Second'), seg(72, 212, '(a) Third'),
  ]);
  const blocks = result.pages[0].blocks;
  assert.deepEqual(blocks.map((b) => b.kind), Array(6).fill('item'));
  assert.deepEqual(blocks.map(plain), [
    '•\tKeep the shared hallway clear.',
    '•\tPut rubbish out on Tuesday evenings, in the bins the council provides, and bring the bins back in by Wednesday night.',
    '•\tNo pets.',
    '1.\tFirst', '2.\tSecond', '(a)\tThird',
  ]);
  assert.deepEqual(blocks.slice(0, 3).map((b) => [b.first, b.left]), [[72, 86], [72, 86], [72, 86]], 'one list, one indent');
  assert.equal(blocks[3].left, 90, 'a list that never wraps gets a quarter inch');
});

test('lines centred on the text, or ending at its right edge, keep that alignment', () => {
  const result = flow([
    seg(72, 100, FULL[0]),
    seg(72, 114, FULL[1]),
    seg(182, 150, 'Both parties keep a signed copy.', { width: 248 }),
    seg(400, 180, 'Riverton, 1 March', { width: 140.5 - 72 + 72 }),
  ]);
  const measure = Math.max(...[FULL[0], FULL[1]].map((t) => 72 + t.length * 5.5));
  const right = flow([seg(72, 100, FULL[1]), seg(measure - 90, 140, 'Riverton, 1 March', { width: 90 })]);
  assert.deepEqual(result.pages[0].blocks.map((b) => b.align).slice(0, 2), ['left', 'center']);
  assert.equal(right.pages[0].blocks[1].align, 'right');
});

test('two columns are read one after the other; a table is not taken for columns', () => {
  const left = ['Meters are read on the last working day of each', 'quarter. Leave the cupboard under the stairs', 'unlocked on that day, or arrange another time.'];
  const right = ['Keys can be copied only with the consent of the', 'landlord. A lost key must be reported within a', 'day, and the locks are changed.'];
  const columns = flow([
    seg(72, 60, 'Notes for the tenant', { size: 14, bold: true }),
    ...left.map((t, i) => seg(72, 90 + i * 13, t, { size: 10, width: 210 - (i === 2 ? 20 : 0) })),
    ...right.map((t, i) => seg(324, 90 + i * 13, t, { size: 10, width: 212 - (i === 2 ? 60 : 0) })),
    seg(72, 160, FULL[0], { size: 10, width: 468 }),
  ]);
  assert.deepEqual(texts(columns), ['Notes for the tenant', left.join(' '), right.join(' '), FULL[0]]);
  assert.deepEqual(columns.pages[0].blocks.map((b) => b.origin), [null, 72, 324, null], 'indents count from the column');
  // set on baselines that do not line up, so the lines of the two columns take turns
  const offset = flow([
    ...left.map((t, i) => seg(72, 90 + i * 13, t, { size: 10, width: 210 - (i === 2 ? 20 : 0) })),
    ...right.map((t, i) => seg(324, 96.5 + i * 13, t, { size: 10, width: 212 - (i === 2 ? 60 : 0) })),
  ]);
  assert.deepEqual(texts(offset), [left.join(' '), right.join(' ')]);
  const table = flow([
    ...['Item', 'Rent', 'Deposit', 'Water'].map((t, i) => seg(72, 100 + i * 16, t)),
    ...['Amount', '950', '1900', '30'].map((t, i) => seg(400, 100 + i * 16, t)),
  ]);
  assert.deepEqual(texts(table), ['Item\tAmount', 'Rent\t950', 'Deposit\t1900', 'Water\t30']);
});

test('pages give the margins around their text; a page with none has no body', () => {
  const result = flow([seg(72, 100, FULL[0]), seg(72, 700, 'Page 1')], []);
  const [first, second] = result.pages;
  assert.deepEqual(first.margins, { top: 89, right: 612 - (72 + FULL[0].length * 5.5), bottom: 792 - 703.3, left: 72 });
  assert.equal(second.margins, null);
  assert.deepEqual(second.blocks, []);
  assert.equal(flow([]).body, null);
});

test('the tenancy agreement comes back as the blocks it was written in', async () => {
  const agreement = await flowDocument();
  const { pages } = await readLayout(agreement.bytes, { background: false });
  const result = flowBlocks(pages);
  const got = result.pages.flatMap((p) => p.blocks.map((b) => ({
    page: p.page,
    kind: b.kind === 'paragraph' && b.align === 'center' ? 'centred' : b.kind === 'paragraph' && b.pieces.some((x) => 'break' in x) ? 'lines' : b.kind,
    text: plain(b).replace(/^•\t/, '• '),
  })));
  assert.deepEqual(got, agreement.blocks.map(({ page, kind, text }) => ({ page, kind, text })));
  const levels = result.pages.flatMap((p) => p.blocks.filter((b) => b.kind === 'heading').map((b) => b.level));
  assert.deepEqual(levels, agreement.blocks.filter((b) => b.kind === 'heading').map((b) => b.level));
  const strong = result.pages[0].blocks[1].pieces.filter((x) => 'text' in x && x.bold).map((x) => 'text' in x && x.text.trim());
  assert.deepEqual(strong, agreement.blocks[1].bold);
});
