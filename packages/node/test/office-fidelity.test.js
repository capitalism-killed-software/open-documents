// How faithful PDF to Word and PowerPoint are: convert, open the result in LibreOffice, turn it
// back into a PDF, and see where every word landed. Needs LibreOffice; skipped without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { textDocument, docxDocument, scaledDocument, unlistedFontDocument } from '@open-documents/fixtures';
import { toDocx, toPptx, extractWords, renderPage, inspect } from '@open-documents/core';
import { createConverter, findLibreOffice } from '../src/index.js';

const skip = (await findLibreOffice()) ? false : 'LibreOffice is not installed';
/** @type {ReturnType<typeof createConverter>} */
let converter;
before(() => {
  converter = createConverter();
});
after(() => converter.close());

/**
 * For each word in `a`, the distance to the nearest same word in `b`.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
async function drift(a, b) {
  const before = await extractWords(a);
  const after = await extractWords(b);
  return before.map((page, p) => page.words.map((w) => {
    const near = after[p].words.filter((v) => v.text === w.text).map((v) => Math.hypot(v.x - w.x, v.y - w.y));
    return { text: w.text, page: p + 1, distance: near.length ? Math.min(...near) : Infinity };
  })).flat();
}

/**
 * The fonts a PDF from LibreOffice draws with, without the subset prefix. LibreOffice writes its
 * font dictionaries as plain text.
 *
 * @param {Uint8Array} pdf
 */
function fontsIn(pdf) {
  const raw = Array.from(pdf, (b) => String.fromCharCode(b)).join('');
  return [...new Set([...raw.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)].map((m) => m[1]))];
}

/** @param {{ data: Uint8Array, width: number, height: number }} a @param {{ data: Uint8Array }} b */
function differing(a, b) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 60) n++;
  return n / (a.width * a.height);
}

for (const [kind, convert] of /** @type {const} */ ([['docx', toDocx], ['pptx', toPptx]])) {
  test(`${kind}: every word comes back within a point and a half of where it was`, { skip }, async () => {
    const pdf = kind === 'docx' ? (await textDocument({ pages: 2, rotation: [0, 90] })).bytes : (await textDocument({ pages: 2 })).bytes;
    const back = await converter.toPdf(await convert(pdf), { filename: `out.${kind}` });
    assert.equal((await inspect(back)).pageCount, 2);
    const far = (await drift(pdf, back)).filter((w) => w.distance > 1.5);
    assert.deepEqual(far, []);
  });

  test(`${kind}: a page with a table looks the same afterwards`, { skip }, async () => {
    const pdf = await converter.toPdf((await docxDocument()).bytes, { filename: 'report.docx' });
    const back = await converter.toPdf(await convert(pdf), { filename: `out.${kind}` });
    const far = (await drift(pdf, back)).filter((w) => w.distance > 1.5);
    assert.deepEqual(far, []);
    const share = differing(await renderPage(pdf, { dpi: 60, format: 'rgba' }), await renderPage(back, { dpi: 60, format: 'rgba' }));
    assert.ok(share < 0.02, `${(share * 100).toFixed(2)}% of the pixels differ`);
  });

  test(`${kind}: a page drawn under a page-wide scale comes back the same size`, { skip }, async () => {
    const { bytes } = await scaledDocument();
    const back = await converter.toPdf(await convert(bytes), { filename: `out.${kind}` });
    // Impress sets a long line a little wider than the PDF did, scaled or not: by the end of a
    // 64-character line at 10 points, about 1.8 points in LibreOffice 26.2 and 2.1 in 24.2. Text
    // sized wrongly lands tens of points away.
    const limit = kind === 'pptx' ? 3 : 1.5;
    const far = (await drift(bytes, back)).filter((w) => w.distance > limit);
    assert.deepEqual(far, []);
  });

  test(`${kind}: text in a font no one has comes back in a sans face, not a serif one`, { skip }, async () => {
    const { bytes } = await unlistedFontDocument();
    const back = await converter.toPdf(await convert(bytes), { filename: `out.${kind}` });
    const fonts = fontsIn(back);
    assert.ok(fonts.length > 0, 'the fonts were found');
    assert.deepEqual(fonts.filter((f) => /serif/i.test(f) && !/sans/i.test(f)), [], `drawn with ${fonts.join(', ')}`);
  });
}
