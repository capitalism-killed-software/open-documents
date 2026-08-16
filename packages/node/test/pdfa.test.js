// PDF/A from office files (LibreOffice's own export), web pages and images (made, then fixed
// up by core's toPdfA). Parts needing LibreOffice or Chromium are skipped without them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { docxDocument, pngImage } from '@open-documents/fixtures';
import { checkPdfA } from '@open-documents/core';
import { createConverter, findLibreOffice } from '../src/index.js';
import { chromium } from 'playwright-core';

const noOffice = (await findLibreOffice()) ? false : 'LibreOffice is not installed';
const noChromium = existsSync(chromium.executablePath()) ? false : 'Chromium is not installed';
const converter = createConverter();
after(() => converter.close());

test('office files come out as PDF/A from LibreOffice, any part', { skip: noOffice }, async () => {
  const docx = (await docxDocument()).bytes;
  for (const part of /** @type {const} */ ([1, 2, 3])) {
    const check = await checkPdfA(await converter.toPdf(docx, { filename: 'report.docx', pdfa: part }), { part });
    assert.deepEqual(check, { claimed: { part, conformance: 'B' }, problems: [] });
  }
});

test('web pages come out as PDF/A too', { skip: noChromium }, async () => {
  const html = new TextEncoder().encode('<h1>Report</h1><p>Plain words.</p>');
  const check = await checkPdfA(await converter.toPdf(html, { filename: 'page.html', pdfa: 2 }));
  assert.deepEqual(check, { claimed: { part: 2, conformance: 'B' }, problems: [] });
});

test('images come out as PDF/A, and a bad part is refused', async () => {
  const check = await checkPdfA(await converter.toPdf(pngImage(), { pdfa: 3 }), { part: 3 });
  assert.deepEqual(check, { claimed: { part: 3, conformance: 'B' }, problems: [] });
  await assert.rejects(converter.toPdf(pngImage(), { pdfa: /** @type {any} */ ('2b') }), { code: 'INVALID_OPTION' });
});
