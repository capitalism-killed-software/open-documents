import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from '@cantoo/pdf-lib';
import { formDocument, textDocument } from '@open-documents/fixtures';
import { getFormFields, fillForm, addFormFields, flatten, extractText, inspect, encrypt } from '../src/index.js';

const form = await formDocument();

/** @param {Uint8Array} bytes */
async function values(bytes, password = undefined) {
  return Object.fromEntries((await getFormFields(bytes, { password })).map((f) => [f.name, f.value]));
}

test('every field, its value, its options and where it is', async () => {
  const fields = await getFormFields(form.bytes);
  assert.deepEqual(fields.map((f) => [f.name, f.type]), [['name', 'text'], ['agree', 'checkbox'], ['colour', 'dropdown'], ['notes', 'text']]);
  assert.deepEqual(await values(form.bytes), { name: 'Sample Person', agree: true, colour: 'green', notes: '' });
  const colour = /** @type {import('../src/forms.js').FormField} */ (fields.find((f) => f.name === 'colour'));
  assert.deepEqual(colour.options, ['red', 'green', 'blue']);
  const [widget] = colour.widgets;
  assert.equal(widget.page, 1);
  assert.ok(widget.width > 100 && widget.height > 20 && widget.y > 150, JSON.stringify(widget));
  assert.equal(fields[1].widgets[0].exportValue, 'Yes');
});

test('fill fields by name; other programs read the same values', async () => {
  const filled = await fillForm(form.bytes, { name: 'Code Person', agree: false, colour: 'blue', notes: 'Line one' });
  assert.deepEqual(await values(filled), { name: 'Code Person', agree: false, colour: 'blue', notes: 'Line one' });
  const other = (await PDFDocument.load(filled)).getForm();
  assert.equal(other.getTextField('name').getText(), 'Code Person');
  assert.equal(other.getCheckBox('agree').isChecked(), false);
  assert.deepEqual(other.getDropdown('colour').getSelected(), ['blue']);
});

test('flattening makes the values part of the page and the form goes away', async () => {
  const flat = await fillForm(form.bytes, { name: 'Typed Name', colour: 'blue', notes: 'Burned in' }, { flatten: true });
  assert.deepEqual(await getFormFields(flat), []);
  assert.equal((await inspect(flat)).forms, 'none');
  const [page] = await extractText(flat);
  for (const text of ['Typed Name', 'blue', 'Burned in']) assert.match(page.text, new RegExp(text));
  assert.doesNotMatch(page.text, /Sample Person|green/);
  const alone = await flatten(form.bytes);
  assert.match((await extractText(alone))[0].text, /Sample Person/);
  assert.equal((await inspect(alone)).forms, 'none');
});

test('nothing is changed when a value does not fit', async () => {
  await assert.rejects(fillForm(form.bytes, { nmae: 'x' }), { code: 'INVALID_OPTION', message: /No field named "nmae". The fields are: name, agree, colour, notes/ });
  await assert.rejects(fillForm(form.bytes, { agree: 'yes' }), { code: 'INVALID_OPTION', message: /check box/ });
  await assert.rejects(fillForm(form.bytes, { colour: 'purple' }), { code: 'INVALID_OPTION', message: /"red", "green", "blue"/ });
  await assert.rejects(fillForm(form.bytes, { name: 12 }), { code: 'INVALID_OPTION', message: /text field/ });
  await assert.rejects(fillForm(form.bytes, /** @type {any} */ ([])), { code: 'INVALID_OPTION' });
});

test('an encrypted form stays encrypted after filling', async () => {
  const locked = await encrypt(form.bytes, { userPassword: 'open', ownerPassword: 'owner' });
  await assert.rejects(fillForm(locked, { name: 'x' }), { code: 'PASSWORD_REQUIRED' });
  const filled = await fillForm(locked, { name: 'Locked Person' }, { password: 'owner' });
  assert.equal((await inspect(filled, { password: 'open' })).encrypted, true);
  assert.equal((await values(filled, 'open')).name, 'Locked Person');
});

test('new fields of every kind, with starting values, where they were asked for', async () => {
  const doc = await textDocument({ pages: 2 });
  const added = await addFormFields(doc.bytes, [
    { type: 'text', name: 'who', page: 1, x: 300, y: 200, width: 180, height: 22, value: 'Sam Sample', required: true },
    { type: 'checkbox', name: 'ok', page: 1, x: 300, y: 240, width: 14, height: 14, value: true },
    { type: 'dropdown', name: 'size', page: 2, x: 300, y: 270, width: 120, height: 22, options: ['S', 'M', 'L'], value: 'M' },
    { type: 'list', name: 'extras', page: 2, x: 300, y: 300, width: 120, height: 50, options: ['a', 'b', 'c'], value: ['a', 'c'], multiple: true },
    { type: 'text', name: 'note', page: 2, x: 72, y: 400, width: 300, height: 60, multiline: true, readOnly: true },
  ]);
  const fields = await getFormFields(added);
  assert.deepEqual(Object.fromEntries(fields.map((f) => [f.name, f.value])), { who: 'Sam Sample', ok: true, size: 'M', extras: ['a', 'c'], note: '' });
  const who = /** @type {import('../src/forms.js').FormField} */ (fields.find((f) => f.name === 'who'));
  assert.deepEqual(who.widgets, [{ page: 1, x: 300, y: 200, width: 180, height: 22 }]);
  assert.equal(who.required, true);
  const note = /** @type {import('../src/forms.js').FormField} */ (fields.find((f) => f.name === 'note'));
  assert.deepEqual([note.readOnly, note.multiline, note.widgets[0].page], [true, true, 2]);
  // read-only stops people, not code
  assert.equal((await values(await fillForm(added, { note: 'From code' }))).note, 'From code');
  const [, two] = await extractText(await flatten(added));
  assert.match(two.text, /M/);
});

test('a field on a turned page is placed where it is asked for, as the page is shown', async () => {
  const doc = await textDocument({ pages: 1, rotation: 90 });
  const added = await addFormFields(doc.bytes, [{ type: 'text', name: 'who', page: 1, x: 500, y: 100, width: 150, height: 20 }]);
  const [field] = await getFormFields(added);
  assert.deepEqual(field.widgets[0], { page: 1, x: 500, y: 100, width: 150, height: 20 });
});

test('bad new fields are refused before any change', async () => {
  const doc = await textDocument({ pages: 1 });
  const ok = { type: /** @type {const} */ ('text'), name: 'a', page: 1, x: 10, y: 10, width: 50, height: 20 };
  await assert.rejects(addFormFields(doc.bytes, []), { code: 'INVALID_OPTION' });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, type: /** @type {any} */ ('radio') }]), { code: 'INVALID_OPTION', message: /type must be/ });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, name: 'a.b' }]), { code: 'INVALID_OPTION', message: /without dots/ });
  await assert.rejects(addFormFields(doc.bytes, [ok, ok]), { code: 'INVALID_OPTION', message: /already a field named "a"/ });
  await assert.rejects(addFormFields(form.bytes, [{ ...ok, name: 'name' }]), { code: 'INVALID_OPTION', message: /already/ });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, page: 2 }]), { code: 'PAGE_NOT_FOUND' });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, width: 0 }]), { code: 'INVALID_OPTION' });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, type: 'dropdown' }]), { code: 'INVALID_OPTION', message: /needs options/ });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, type: 'list', options: ['x', 'y'], value: ['x', 'y'] }]), { code: 'INVALID_OPTION', message: /does not suit/ });
  await assert.rejects(addFormFields(doc.bytes, [{ ...ok, type: 'checkbox', value: 'yes' }]), { code: 'INVALID_OPTION', message: /does not suit/ });
});
