import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { setMetadata, inspect } from '../src/index.js';

const doc = await textDocument({ pages: 1 });

test('changes the fields given and keeps the rest', async () => {
  const out = await setMetadata(doc.bytes, { title: 'Lease, 14 Elm Street', author: 'Property Office', keywords: ['lease', 'signed'] });
  const { metadata } = await inspect(out);
  assert.equal(metadata.title, 'Lease, 14 Elm Street');
  assert.equal(metadata.author, 'Property Office');
  assert.equal(metadata.keywords, 'lease, signed');
  assert.equal(metadata.subject, 'Test document');
});

test('null clears a field, and dates are written the PDF way', async () => {
  const when = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
  const out = await setMetadata(doc.bytes, { author: null, subject: '', modDate: when, creationDate: 'D:19991231235959Z' });
  const { metadata } = await inspect(out);
  assert.equal(metadata.author, '');
  assert.equal(metadata.subject, '');
  assert.equal(metadata.modDate, 'D:20240102030405Z');
  assert.equal(metadata.creationDate, 'D:19991231235959Z');
});

test('text outside Latin survives', async () => {
  const out = await setMetadata(doc.bytes, { title: 'Договор · 契約書' });
  assert.equal((await inspect(out)).metadata.title, 'Договор · 契約書');
});

test('works on encrypted files and keeps them encrypted', async () => {
  const locked = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  const out = await setMetadata(locked.bytes, { title: 'Locked', password: 'open' });
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  assert.equal((await inspect(out, { password: 'open' })).metadata.title, 'Locked');
});

test('unknown fields and wrong types are refused', async () => {
  await assert.rejects(setMetadata(doc.bytes, /** @type {any} */ ({ colour: 'red' })), { code: 'INVALID_OPTION', message: /Unknown metadata field/ });
  await assert.rejects(setMetadata(doc.bytes, /** @type {any} */ ({ title: 5 })), { code: 'INVALID_OPTION' });
  await assert.rejects(setMetadata(doc.bytes, { modDate: new Date('nope') }), { code: 'INVALID_OPTION' });
  await assert.rejects(setMetadata(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
});
