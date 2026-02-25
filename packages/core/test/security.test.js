import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument } from '@open-documents/fixtures';
import { encrypt, decrypt, inspect, extractText } from '../src/index.js';

const doc = await textDocument({ pages: 2 });

test('locks with AES-256 and opens with the password', async () => {
  const out = await encrypt(doc.bytes, { userPassword: 'open sesame', ownerPassword: 'master' });
  const raw = new TextDecoder('latin1').decode(out);
  assert.match(raw, /\/V 5/);
  assert.match(raw, /\/R 6/);
  assert.doesNotMatch(raw, /quick brown fox/, 'the text is not readable in the file');
  await assert.rejects(inspect(out), { code: 'PASSWORD_REQUIRED' });
  const info = await inspect(out, { password: 'open sesame' });
  assert.equal(info.encrypted, true);
  assert.equal((await extractText(out, { password: 'master' }))[0].text, (await extractText(doc.bytes))[0].text);
});

test('permissions without a user password: anyone can open, limits apply', async () => {
  const out = await encrypt(doc.bytes, { permissions: { copy: false, print: 'low', modify: false } });
  const info = await inspect(out);
  assert.equal(info.encrypted, true);
  assert.equal(info.permissions & (1 << 4), 0, 'no copying');
  assert.equal(info.permissions & (1 << 3), 0, 'no changes');
  assert.notEqual(info.permissions & (1 << 2), 0, 'printing is allowed');
  assert.equal(info.permissions & (1 << 11), 0, 'but only at low resolution');
  assert.notEqual(info.permissions & (1 << 5), 0, 'comments are allowed');
});

test('decrypt with the user password when nothing is restricted', async () => {
  const locked = await encrypt(doc.bytes, { userPassword: 'open', ownerPassword: 'owner' });
  const open = await decrypt(locked, { password: 'open' });
  const info = await inspect(open);
  assert.equal(info.encrypted, false);
  assert.equal(info.permissions, -1);
});

test('restrictions can only be lifted with the owner password', async () => {
  const locked = await encrypt(doc.bytes, { userPassword: 'open', ownerPassword: 'owner', permissions: { copy: false } });
  await assert.rejects(decrypt(locked, { password: 'open' }), { code: 'PASSWORD_REQUIRED', message: /owner password/ });
  assert.equal((await inspect(await decrypt(locked, { password: 'owner' }))).encrypted, false);
  const noOwnerKnown = await encrypt(doc.bytes, { permissions: { print: false } });
  await assert.rejects(decrypt(noOwnerKnown), { code: 'PASSWORD_REQUIRED' });
});

test('re-encrypting replaces the old passwords', async () => {
  const first = await encrypt(doc.bytes, { userPassword: 'one', ownerPassword: 'owner-one' });
  const second = await encrypt(first, { password: 'owner-one', userPassword: 'two', ownerPassword: 'owner-two' });
  await assert.rejects(inspect(second, { password: 'one' }), { code: 'PASSWORD_REQUIRED' });
  assert.equal((await inspect(second, { password: 'two' })).pageCount, 2);
});

test('older encryption from other tools can be removed', async () => {
  const aes128 = await textDocument({ pages: 1, encrypt: { userPassword: 'open' } });
  assert.equal((await inspect(await decrypt(aes128.bytes, { password: 'owner' }))).encrypted, false);
});

test('decrypting a file that is not encrypted changes nothing important', async () => {
  const out = await decrypt(doc.bytes);
  assert.equal((await inspect(out)).encrypted, false);
});

test('bad options are refused', async () => {
  await assert.rejects(encrypt(doc.bytes, /** @type {any} */ ({})), { code: 'INVALID_OPTION' });
  await assert.rejects(encrypt(doc.bytes, /** @type {any} */ (undefined)), { code: 'INVALID_OPTION' });
  await assert.rejects(encrypt(doc.bytes, { userPassword: 'same', ownerPassword: 'same' }), { code: 'INVALID_OPTION' });
  await assert.rejects(encrypt(doc.bytes, { userPassword: 'x'.repeat(128) }), { code: 'INVALID_OPTION' });
  await assert.rejects(encrypt(doc.bytes, /** @type {any} */ ({ userPassword: 5 })), { code: 'INVALID_OPTION' });
  await assert.rejects(encrypt(doc.bytes, /** @type {any} */ ({ permissions: { copy: 'no' } })), { code: 'INVALID_OPTION' });
});
