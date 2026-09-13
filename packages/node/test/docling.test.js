// Needs the Python worker set up (uv sync in packages/node/python) and Docling's models
// downloaded. Skipped otherwise; CI runs these in the structure job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reportDocument, textDocument, REPORT_TABLE } from '@open-documents/fixtures';
import { encrypt } from '@open-documents/core';
import { createConverter, createDocling, findPython, doclingModels } from '../src/index.js';

const ready = findPython() && existsSync(doclingModels());
const skip = ready ? false : 'Docling is not set up (see packages/node/python)';
const report = await reportDocument();
/** @type {ReturnType<typeof createConverter>} */
let converter;
before(() => {
  converter = createConverter();
});
after(() => converter.close());

test('pdf to markdown keeps headings, paragraphs and tables, in reading order', { skip }, async () => {
  const markdown = await converter.pdfToMarkdown(report.bytes);
  assert.match(markdown, /^## Quarterly Report$/m);
  assert.match(markdown, /Revenue grew in every region/);
  assert.match(markdown, /^\| Region\s+\|\s+Revenue\s+\|\s+Costs\s+\|$/m);
  assert.match(markdown, /^\| West\s+\|\s+1430\s+\|\s+910\s+\|$/m);
  assert.ok(markdown.indexOf('Quarterly Report') < markdown.indexOf('Second page'));
});

test('pdf to html and to json', { skip }, async () => {
  const html = await converter.pdfToHtml(report.bytes);
  assert.match(html, /<table>/);
  assert.match(html, /<h2>Quarterly Report<\/h2>/);
  const json = await converter.pdfToJson(report.bytes);
  assert.equal(json.tables.length, 1);
  assert.ok(json.texts.some((/** @type {{ text: string }} */ t) => t.text === 'Only words here.'));
});

test('tables to excel: one sheet per table, numbers as numbers', { skip }, async () => {
  const xlsx = unzipSync(await converter.pdfToXlsx(report.bytes));
  assert.match(strFromU8(xlsx['xl/workbook.xml']), /name="Page 1 table 1"/);
  const sheet = strFromU8(xlsx['xl/worksheets/sheet1.xml']);
  const shared = strFromU8(xlsx['xl/sharedStrings.xml'] ?? new Uint8Array());
  for (const word of REPORT_TABLE.flat().filter((c) => /\D/.test(c))) assert.ok(shared.includes(`>${word}<`) || sheet.includes(`>${word}<`), `"${word}" is in the sheet`);
  assert.match(sheet, /<v>1430<\/v>/, 'figures are stored as numbers');
});

test('only the pages asked for', { skip }, async () => {
  const markdown = await converter.pdfToMarkdown(report.bytes, { pages: [2] });
  assert.match(markdown, /Second page/);
  assert.doesNotMatch(markdown, /Quarterly Report/);
});

test('a document without tables has no workbook to give', { skip }, async () => {
  await assert.rejects(converter.pdfToXlsx(report.bytes, { pages: [2] }), { code: 'CONVERSION_FAILED', message: /No tables/ });
});

test('encrypted files are read with their password', { skip }, async () => {
  const locked = await encrypt(report.bytes, { userPassword: 'secret' });
  await assert.rejects(converter.pdfToMarkdown(locked), { code: 'PASSWORD_REQUIRED' });
  assert.match(await converter.pdfToMarkdown(locked, { password: 'secret' }), /Quarterly Report/);
});

test('a document that takes too long is stopped, and the next one still works', { skip }, async () => {
  const docling = await createDocling();
  try {
    assert.match(await docling.version(), /^\d+\.\d+/);
    const doc = await textDocument({ pages: 1 });
    // the next request is sent at once, before the stopped worker has finished exiting
    const [late, again] = await Promise.allSettled([
      docling.convert(doc.bytes, { to: ['markdown'], timeout: 1 }),
      docling.convert(doc.bytes, { to: ['text'] }),
    ]);
    assert.equal(late.status === 'rejected' && /** @type {any} */ (late.reason).code, 'TIMEOUT');
    assert.equal(again.status, 'fulfilled', again.status === 'rejected' ? String(again.reason) : '');
    assert.match(/** @type {string} */ (/** @type {PromiseFulfilledResult<any>} */ (again).value.text), /quick brown fox/);
  } finally {
    await docling.close();
  }
  await assert.rejects(docling.version(), { code: 'ENGINE_ERROR', message: /closed/ });
});

test('without python or models, it says how to set them up', async () => {
  const noModels = await createDocling({ python: process.execPath, models: '/nowhere/models' });
  try {
    await assert.rejects(noModels.convert(new Uint8Array([37, 80, 68, 70, 45]), { to: ['markdown'] }), { code: 'ENGINE_MISSING', message: /docling-tools models download/ });
  } finally {
    await noModels.close();
  }
  const missing = await createDocling({ python: '/nowhere/python3', models: '.' });
  try {
    await assert.rejects(missing.version(), { code: 'ENGINE_MISSING', message: /No Python at/ });
  } finally {
    await missing.close();
  }
});

test('a scanned report, made searchable, gives its table to markdown and excel', { skip }, async () => {
  const { renderPages, imagesToPdf } = await import('@open-documents/core');
  const { ocr } = await import('@open-documents/ocr');
  const scan = await imagesToPdf((await renderPages(report.bytes, { pages: [1], dpi: 200 })).map((p) => p.data), { pageSize: 'fit', dpi: 200 });
  const searchable = await ocr(scan, { workers: 1 });
  const markdown = await converter.pdfToMarkdown(searchable);
  assert.match(markdown, /^## Quarterly Report$/m, 'one space between the words read');
  assert.match(markdown, /^\| West\s+\|\s+1430\s+\|\s+910\s+\|$/m);
  const sheet = strFromU8(unzipSync(await converter.pdfToXlsx(searchable))['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<v>1430<\/v>/);
});
