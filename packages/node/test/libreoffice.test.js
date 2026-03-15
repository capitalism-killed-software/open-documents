// Needs LibreOffice. Skipped when it is not installed; CI runs these in the conversions job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { docxDocument, docxWithLinkedImage, pptxDocument, xlsxDocument, odtDocument, rtfDocument, csvDocument } from '@open-documents/fixtures';
import { extractText, inspect } from '@open-documents/core';
import { createLibreOffice, findLibreOffice } from '../src/index.js';

const binary = await findLibreOffice();
const skip = binary ? false : 'LibreOffice is not installed';
/** @type {import('../src/libreoffice.js').LibreOffice} */
let lo;

before(async () => {
  if (binary) lo = await createLibreOffice({ slots: 2 });
});
after(() => lo?.close());

/** @param {Uint8Array} pdf */
async function words(pdf) {
  return (await extractText(pdf)).map((p) => p.text).join(' ').split(/\s+/);
}

for (const [name, make] of /** @type {const} */ ([
  ['docx', docxDocument], ['pptx', pptxDocument], ['xlsx', xlsxDocument], ['odt', odtDocument], ['rtf', rtfDocument], ['csv', csvDocument],
])) {
  test(`${name} to pdf keeps its text`, { skip }, async () => {
    const doc = await make();
    const pdf = await lo.convert(doc.bytes, { kind: /** @type {any} */ (doc.ext === 'csv' ? 'csv' : doc.ext) });
    assert.ok((await inspect(pdf)).pageCount >= 1);
    const found = await words(pdf);
    for (const w of doc.words) assert.ok(found.includes(w), `"${w}" in the ${name} output`);
  });
}

test('plain text goes through Writer', { skip }, async () => {
  const pdf = await lo.convert(new TextEncoder().encode('Plain words here.\n'), { kind: 'text' });
  assert.ok((await words(pdf)).includes('Plain'));
});

test('several at once share the slots', { skip }, async () => {
  const docs = await Promise.all([docxDocument(), odtDocument(), rtfDocument(), csvDocument()]);
  const pdfs = await Promise.all(docs.map((d) => lo.convert(d.bytes, { kind: /** @type {any} */ (d.ext) })));
  assert.equal(pdfs.length, 4);
});

test('profiles are locked down: macros off, links never updated', { skip }, async () => {
  await lo.convert(rtfDocument().bytes, { kind: 'rtf' });
  const profiles = (await readdir(lo.workDir)).filter((n) => n.startsWith('profile-'));
  assert.ok(profiles.length >= 1);
  const settings = await readFile(join(lo.workDir, profiles[0], 'user', 'registrymodifications.xcu'), 'utf8');
  assert.match(settings, /DisableMacrosExecution" oor:op="fuse"><value>true</);
  assert.match(settings, /Writer\/Content\/Update"><prop oor:name="Link" oor:op="fuse"><value>2</);
  assert.match(settings, /Calc\/Content\/Update"><prop oor:name="Link" oor:op="fuse"><value>1</);
});

test('job files are removed afterwards', { skip }, async () => {
  await lo.convert(rtfDocument().bytes, { kind: 'rtf' });
  assert.deepEqual((await readdir(lo.workDir)).filter((n) => n.startsWith('job-')), []);
});

test('a picture linked from the web is never fetched', { skip }, async () => {
  /** @type {string[]} */
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(String(req.url));
    res.writeHead(200, { 'content-type': 'image/png' }).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  try {
    const address = /** @type {import('node:net').AddressInfo} */ (server.address());
    const doc = docxWithLinkedImage(`http://127.0.0.1:${address.port}/tracking.png`);
    const pdf = await lo.convert(doc.bytes, { kind: 'docx' });
    assert.ok((await words(pdf)).includes('Before'));
    assert.deepEqual(hits, [], 'no request reached the linked server');
  } finally {
    server.close();
  }
});

test('a broken file fails cleanly', { skip }, async () => {
  await assert.rejects(lo.convert(new TextEncoder().encode('PK\u0003\u0004 not a document'), { kind: 'docx' }), { code: 'CONVERSION_FAILED' });
});

test('a conversion that takes too long is stopped', { skip }, async () => {
  const doc = await docxDocument();
  await assert.rejects(lo.convert(doc.bytes, { kind: 'docx', timeout: 50 }), { code: 'TIMEOUT' });
  // and the slot still works afterwards
  assert.ok((await inspect(await lo.convert(doc.bytes, { kind: 'docx' }))).pageCount >= 1);
});

test('kinds LibreOffice does not handle are refused', { skip }, async () => {
  await assert.rejects(lo.convert(new Uint8Array(1), { kind: /** @type {any} */ ('png') }), { code: 'INVALID_OPTION' });
});

test('a missing LibreOffice is reported', async () => {
  await assert.rejects(createLibreOffice({ binary: '' }), { code: 'ENGINE_MISSING' });
  const fake = await createLibreOffice({ binary: '/nonexistent/soffice', workDir: join(process.cwd(), 'coverage', 'lo-missing') });
  await assert.rejects(fake.convert(new Uint8Array(1), { kind: 'docx' }), { code: 'ENGINE_MISSING' });
  await fake.close();
});

