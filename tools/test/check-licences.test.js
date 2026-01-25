import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { licenceAllowed, checkLockfile, deniedReason } from '../check-licences.js';

const policy = JSON.parse(await readFile(new URL('../licence-policy.json', import.meta.url), 'utf8'));
const allowed = new Set(policy.allow);

/** @param {Record<string, object>} packages */
const lock = (packages) => ({
  packages: Object.fromEntries(Object.entries(packages).map(([name, e]) => [`node_modules/${name}`, { version: '1.0.0', ...e }])),
});

test('simple, OR, AND and nested expressions', () => {
  assert.equal(licenceAllowed('MIT', allowed), true);
  assert.equal(licenceAllowed('AGPL-3.0-only', allowed), false);
  assert.equal(licenceAllowed('(MIT OR GPL-3.0)', allowed), true);
  assert.equal(licenceAllowed('MIT AND Zlib', allowed), true);
  assert.equal(licenceAllowed('(MIT AND GPL-2.0)', allowed), false);
  assert.equal(licenceAllowed('(GPL-2.0 OR (MIT AND BSD-3-Clause))', allowed), true);
  assert.equal(licenceAllowed('Apache-2.0 WITH LLVM-exception', allowed), true);
  assert.equal(licenceAllowed('MPL-2.0', allowed), false);
  assert.throws(() => licenceAllowed('(MIT', allowed), /Unbalanced/);
  assert.throws(() => licenceAllowed('MIT OR', allowed), /Cannot read/);
  assert.throws(() => licenceAllowed('MIT BSD-2-Clause', allowed), /Cannot read/);
});

test('the real lockfile passes', async () => {
  const real = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkLockfile(real, policy), []);
});

test('a GPL dependency fails', () => {
  const problems = checkLockfile(lock({ 'some-lib': { license: 'GPL-3.0-only' } }), policy);
  assert.deepEqual(problems, ['some-lib@1.0.0: licence GPL-3.0-only is not on the allow list']);
});

test('denied packages fail whatever licence they claim', () => {
  const problems = checkLockfile(lock({ 'pdf2pic': { license: 'MIT' }, '@mupdf/core': { license: 'MIT' } }), policy);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /pdf2pic@1.0.0: never allowed \(runs GraphicsMagick and Ghostscript\)/);
  assert.match(problems[1], /@mupdf\/core@1.0.0: never allowed/);
  assert.equal(deniedReason('Sharp', policy.deny), 'ships libvips, which is LGPL');
  assert.equal(deniedReason('@cantoo/pdf-lib', policy.deny), undefined);
});

test('a missing licence fails unless there is a written exception', () => {
  assert.deepEqual(checkLockfile(lock({ mystery: {} }), policy), ['mystery@1.0.0: no licence declared']);
  const excused = { ...policy, exceptions: { 'mystery@1.0.0': 'checked by hand: MIT in the repo' } };
  assert.deepEqual(checkLockfile(lock({ mystery: {} }), excused), []);
});

test('a broken expression is a problem, not a crash', () => {
  assert.match(checkLockfile(lock({ odd: { license: '(MIT' } }), policy)[0], /odd@1.0.0: Unbalanced/);
});

test('workspace links and the root are skipped', () => {
  const tree = { packages: { '': { name: 'root' }, 'node_modules/@open-documents/core': { link: true } } };
  assert.deepEqual(checkLockfile(tree, policy), []);
});
