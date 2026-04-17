// Needs qpdf: on the PATH, $OPENDOCS_QPDF, or `npm run fetch-binaries`. Skipped otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument, damagedDocument } from '@open-documents/fixtures';
import { extractText, inspect } from '@open-documents/core';
import { createQpdf, findQpdf } from '../src/index.js';

const skip = (await findQpdf()) ? false : 'qpdf is not installed';
const qpdf = skip ? null : await createQpdf();
/** @param {Uint8Array} pdf */
const texts = async (pdf, password = '') => (await extractText(pdf, { password })).map((p) => p.text);

test('compress makes the file smaller and loses nothing', { skip }, async () => {
  const doc = await textDocument({ pages: 60 });
  const out = await /** @type {any} */ (qpdf).compress(doc.bytes);
  assert.ok(out.length < doc.bytes.length * 0.8, `${doc.bytes.length} -> ${out.length} bytes`);
  assert.deepEqual(await texts(out), await texts(doc.bytes));
  assert.equal((await inspect(out)).metadata.title, 'Fixture');
});

test('linearize puts the fast web view dictionary first', { skip }, async () => {
  const doc = await textDocument({ pages: 5 });
  const out = await /** @type {any} */ (qpdf).linearize(doc.bytes);
  assert.match(new TextDecoder('latin1').decode(out.subarray(0, 1024)), /\/Linearized/);
  assert.equal((await inspect(out)).pageCount, 5);
});

test('repair rebuilds a broken cross-reference table', { skip }, async () => {
  const q = /** @type {any} */ (qpdf);
  const broken = await damagedDocument();
  assert.equal((await q.check(broken.bytes)).ok, false, 'qpdf notices the damage');
  const fixed = await q.repair(broken.bytes);
  const report = await q.check(fixed);
  assert.equal(report.ok, true, report.messages.join('\n'));
  assert.deepEqual(await texts(fixed), broken.truth.pages.map((p) => p.lines.join('\n')));
});

test('encrypted files need their password and stay encrypted', { skip }, async () => {
  const q = /** @type {any} */ (qpdf);
  const locked = await textDocument({ pages: 3, encrypt: { userPassword: 'open' } });
  await assert.rejects(q.compress(locked.bytes), { code: 'PASSWORD_REQUIRED' });
  await assert.rejects(q.compress(locked.bytes, { password: 'wrong' }), { code: 'PASSWORD_REQUIRED' });
  const out = await q.compress(locked.bytes, { password: 'open' });
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  assert.equal((await inspect(out, { password: 'open' })).pageCount, 3);
});

test('a file that is not a PDF at all', { skip }, async () => {
  await assert.rejects(/** @type {any} */ (qpdf).repair(new TextEncoder().encode('nothing like a pdf')), { code: 'DAMAGED_FILE' });
});

test('a missing qpdf is reported', async () => {
  await assert.rejects(createQpdf({ binary: '' }), { code: 'ENGINE_MISSING' });
  const fake = await createQpdf({ binary: '/nonexistent/qpdf' });
  await assert.rejects(fake.compress(new Uint8Array(1)), { code: 'ENGINE_MISSING' });
});
