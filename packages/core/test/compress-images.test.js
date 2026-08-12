import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import { reportDocument } from '@open-documents/fixtures';
import { compressImages, imagesToPdf, renderPages, renderPage, encrypt, inspect } from '../src/index.js';
import { encodePng } from '../src/png.js';
import { downscale } from '../src/edit/images.js';
import { engine } from '../src/engine/pdfium.js';

const report = (await reportDocument()).bytes;
const textScan = await imagesToPdf((await renderPages(report, { dpi: 300 })).map((p) => p.data), { pageSize: 'fit', dpi: 300 });

/** A noisy, photograph-like page at 300 dpi. */
function photoPng() {
  const w = 1800;
  const h = 2400;
  const rgba = new Uint8Array(w * h * 4);
  let seed = 1;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = seed % 24;
    rgba.set([200 + n - (i % w) / 40, 190 + n, 170 + n, 255], i * 4);
  }
  return encodePng(rgba, w, h);
}

/** @param {Uint8Array} bytes */
async function imageSizes(bytes) {
  const pdf = await engine();
  const { fn } = pdf;
  return pdf.withDocument(bytes, {}, (doc) => Array.from({ length: fn.FPDF_GetPageCount(doc) }, (_, i) => pdf.withPage(doc, i, (page) => {
    const obj = fn.FPDFPage_GetObject(page, 0);
    const meta = pdf.malloc(28);
    try {
      fn.FPDFImageObj_GetImageMetadata(obj, page, meta);
      return [pdf.wasm.getValue(meta, 'i32'), pdf.wasm.getValue(meta + 4, 'i32')];
    } finally {
      pdf.free(meta);
    }
  })));
}

/** @param {Uint8Array} a @param {Uint8Array} b */
async function differing(a, b) {
  const [x] = await renderPages(a, { pages: [1], dpi: 72, format: 'rgba' });
  const [y] = await renderPages(b, { pages: [1], dpi: 72, format: 'rgba' });
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) if (Math.abs(x.data[i] - y.data[i]) > 48) n++;
  return n / (x.width * x.height);
}

test('a 300 dpi scan of text comes down to 150 dpi, smaller and looking the same', async () => {
  const small = await compressImages(textScan);
  assert.ok(small.length < textScan.length * 0.7, `${textScan.length} to ${small.length}`);
  assert.deepEqual(await imageSizes(small), [[1275, 1650], [1275, 1650]]);
  assert.ok((await differing(textScan, small)) < 0.002);
  assert.deepEqual((await inspect(small)).pages.map((p) => [p.width, p.height]), [[612, 792], [612, 792]]);
});

test('a photograph-like scan shrinks to a fraction as JPEG', async () => {
  const photo = await imagesToPdf([photoPng()], { pageSize: 'fit', dpi: 300 });
  const small = await compressImages(photo, { dpi: 100, quality: 60 });
  assert.ok(small.length < photo.length * 0.1, `${photo.length} to ${small.length}`);
  assert.deepEqual(await imageSizes(small), [[600, 800]]);
  const better = await compressImages(photo, { dpi: 100, quality: 95 });
  assert.ok(better.length > small.length, 'higher quality costs bytes');
});

test('images already at the target are left as they are', async () => {
  const already = await compressImages(textScan, { dpi: 300 });
  assert.deepEqual(await imageSizes(already), [[2550, 3300], [2550, 3300]]);
  const twice = await compressImages(await compressImages(textScan));
  assert.deepEqual(await imageSizes(twice), [[1275, 1650], [1275, 1650]]);
});

test('images with transparency are left alone, so their masks survive', async () => {
  const w = 900;
  const px = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) px.set([30, 60, 160, (x - 450) ** 2 + (y - 450) ** 2 < 300 ** 2 ? 255 : 0], (y * w + x) * 4);
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(1, 0, 0) });
  page.drawImage(await doc.embedPng(encodePng(px, w, w)), { x: 50, y: 50, width: 200, height: 200 });
  const out = await compressImages(await doc.save());
  const shown = await renderPage(out, { dpi: 72, format: 'rgba' });
  const corner = [...shown.data.subarray((60 * shown.width + 60) * 4, (60 * shown.width + 60) * 4 + 3)];
  assert.deepEqual(corner, [255, 0, 0], 'the red shows through the transparent corner');
});

test('an encrypted scan stays encrypted', async () => {
  const locked = await encrypt(textScan, { userPassword: 'pw' });
  const small = await compressImages(locked, { password: 'pw' });
  assert.equal((await inspect(small, { password: 'pw' })).encrypted, true);
  assert.ok(small.length < locked.length);
});

test('downscale averages each block of pixels', () => {
  const src = new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255]);
  assert.deepEqual([...downscale(src, 2, 2, 1, 1)], [100, 100, 100, 255]);
});

test('bad options are refused', async () => {
  await assert.rejects(compressImages(textScan, { dpi: 10 }), { code: 'INVALID_OPTION' });
  await assert.rejects(compressImages(textScan, { quality: 0 }), { code: 'INVALID_OPTION' });
});
