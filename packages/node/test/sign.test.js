// Signing and checking signatures, with pyHanko in the Python worker. Needs the worker set up
// (uv sync in packages/node/python); Docling's models are not needed. A made-up certificate
// authority and signer are made for the run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { textDocument } from '@open-documents/fixtures';
import { addFormFields, getFormFields, encrypt, inspect, addText } from '@open-documents/core';
import { createConverter, findPython } from '../src/index.js';

const python = findPython();
const skip = python ? false : 'The Python worker is not set up (see packages/node/python)';
let dir = '';
/** @type {{ p12: Uint8Array, ca: Uint8Array, other: Uint8Array }} */
let id;
/** @type {ReturnType<typeof createConverter>} */
let converter;
const doc = (await textDocument({ pages: 2 })).bytes;

before(async () => {
  converter = createConverter();
  if (!python) return;
  dir = await mkdtemp(join(tmpdir(), 'od-sign-'));
  await promisify(execFile)(python, [fileURLToPath(new URL('make-identity.py', import.meta.url)), dir]);
  id = { p12: await readFile(join(dir, 'signer.p12')), ca: await readFile(join(dir, 'ca.pem')), other: await readFile(join(dir, 'other-ca.pem')) };
});
after(async () => {
  await converter.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('a visible signature: intact, valid, and trusted by its own authority only', { skip }, async () => {
  const signed = await converter.sign(doc, { certificate: id.p12, password: 'secret', page: 1, x: 72, y: 600, width: 220, height: 60, reason: 'Approved', location: 'Sacramento' });
  const [check] = await converter.verifySignatures(signed, { trustRoots: [id.ca] });
  assert.deepEqual(
    { field: check.field, signer: check.signer, intact: check.intact, valid: check.valid, trusted: check.trusted, coverage: check.coverage },
    { field: 'Signature1', signer: 'Sam Signer', intact: true, valid: true, trusted: true, coverage: 'ENTIRE_FILE' },
  );
  assert.ok(check.signedAt && !Number.isNaN(Date.parse(check.signedAt)));
  const [untrusted] = await converter.verifySignatures(signed, { trustRoots: [id.other] });
  assert.deepEqual([untrusted.valid, untrusted.trusted], [true, false]);
  const [field] = (await getFormFields(signed)).filter((f) => f.type === 'signature');
  assert.deepEqual(field.widgets[0], { page: 1, x: 72, y: 600, width: 220, height: 60 });
  assert.equal((await inspect(signed)).signatures, 1);
});

test('a change after signing shows', { skip }, async () => {
  const signed = await converter.sign(doc, { certificate: id.p12, password: 'secret' });
  const [before] = await converter.verifySignatures(signed, { trustRoots: [id.ca] });
  assert.equal(before.coverage, 'ENTIRE_FILE');
  const changed = await addText(signed, { text: 'Added later', at: { x: 72, y: 40 } });
  const [after] = await converter.verifySignatures(changed, { trustRoots: [id.ca] });
  assert.notEqual(after.coverage, 'ENTIRE_FILE', 'the signature no longer covers the whole file');
});

test('sign into an empty signature field placed beforehand, then a second one', { skip }, async () => {
  const withFields = await addFormFields(doc, [
    { type: 'signature', name: 'author', page: 1, x: 72, y: 500, width: 200, height: 50 },
    { type: 'signature', name: 'approver', page: 2, x: 72, y: 500, width: 200, height: 50 },
  ]);
  const once = await converter.sign(withFields, { certificate: id.p12, password: 'secret', field: 'author' });
  const twice = await converter.sign(once, { certificate: id.p12, password: 'secret', field: 'approver' });
  const checks = await converter.verifySignatures(twice, { trustRoots: [id.ca] });
  assert.deepEqual(checks.map((c) => [c.field, c.intact, c.valid]), [['author', true, true], ['approver', true, true]]);
  assert.equal(checks[0].coverage, 'ENTIRE_REVISION', 'the first covers its revision, the second the whole file');
  assert.equal(checks[1].coverage, 'ENTIRE_FILE');
  await assert.rejects(converter.sign(twice, { certificate: id.p12, password: 'secret', field: 'author' }), { code: 'INVALID_OPTION', message: /signed already/ });
});

test('an encrypted file is signed with its password', { skip }, async () => {
  const locked = await encrypt(doc, { userPassword: 'open', ownerPassword: 'owner' });
  await assert.rejects(converter.sign(locked, { certificate: id.p12, password: 'secret' }), { code: 'PASSWORD_REQUIRED' });
  const signed = await converter.sign(locked, { certificate: id.p12, password: 'secret', documentPassword: 'owner' });
  const [check] = await converter.verifySignatures(signed, { trustRoots: [id.ca], documentPassword: 'open' });
  assert.deepEqual([check.intact, check.valid], [true, true]);
});

test('wrong certificate passwords and files are refused', { skip }, async () => {
  await assert.rejects(converter.sign(doc, { certificate: id.p12, password: 'wrong' }), { code: 'INVALID_INPUT', message: /PKCS#12/ });
  await assert.rejects(converter.sign(doc, { certificate: new Uint8Array([1, 2, 3]) }), { code: 'INVALID_INPUT' });
  await assert.rejects(converter.sign(doc, /** @type {any} */ ({ certificate: 'not bytes' })), { code: 'INVALID_OPTION' });
  await assert.rejects(converter.verifySignatures(doc, { trustRoots: [new Uint8Array([9, 9])] }), { code: 'INVALID_INPUT', message: /trust root/ });
  assert.deepEqual(await converter.verifySignatures(doc), [], 'no signatures in an unsigned file');
});

test('an empty signature field cannot take a value, and encrypted files cannot get one', async () => {
  const field = { type: /** @type {const} */ ('signature'), name: 's', page: 1, x: 72, y: 500, width: 200, height: 50 };
  await assert.rejects(addFormFields(doc, [{ ...field, value: 'x' }]), { code: 'INVALID_OPTION', message: /filled by signing/ });
  await assert.rejects(addFormFields(await encrypt(doc, { userPassword: 'pw' }), [field], { password: 'pw' }), { code: 'UNSUPPORTED_SECURITY' });
});
