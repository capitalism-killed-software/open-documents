import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  textDocument, docxDocument, pptxDocument, xlsxDocument, odtDocument, rtfDocument, csvDocument, pngImage, jpegImage,
} from '@open-documents/fixtures';
import { sniff, checkZip } from '../src/index.js';

test('office files are told apart by their contents', async () => {
  assert.deepEqual(sniff((await docxDocument()).bytes), { kind: 'docx', family: 'office' });
  assert.equal(sniff((await pptxDocument()).bytes).kind, 'pptx');
  assert.equal(sniff(xlsxDocument().bytes).kind, 'xlsx');
  assert.equal(sniff(odtDocument().bytes).kind, 'odt');
  assert.equal(sniff(rtfDocument().bytes).kind, 'rtf');
});

test('a misleading name does not matter', async () => {
  assert.equal(sniff((await docxDocument()).bytes, { filename: 'photo.jpg' }).kind, 'docx');
  assert.equal(sniff((await textDocument({ pages: 1 })).bytes, { filename: 'report.docx' }).kind, 'pdf');
});

test('images, PDFs and text', async () => {
  assert.equal(sniff(pngImage()).family, 'image');
  assert.equal(sniff(jpegImage()).kind, 'jpeg');
  assert.equal(sniff(strToU8('GIF89a....')).kind, 'gif');
  assert.equal(sniff(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1])).kind, 'tiff');
  assert.equal(sniff(strToU8('RIFF\0\0\0\0WEBPVP8 ')).kind, 'webp');
  assert.equal(sniff(strToU8('BM...'), { filename: 'x.bmp' }).kind, 'bmp');
  assert.equal(sniff(strToU8('  <!DOCTYPE html><p>hi')).kind, 'html');
  assert.equal(sniff(strToU8('<html><body>hi')).kind, 'html');
  assert.equal(sniff(strToU8('# Title\n\ntext'), { filename: 'notes.md' }).kind, 'markdown');
  assert.equal(sniff(csvDocument().bytes, { filename: 'data.csv' }).kind, 'csv');
  assert.equal(sniff(strToU8('just words')).kind, 'text');
  assert.equal(sniff(strToU8('\uFEFF<html>')).kind, 'html');
  assert.equal(sniff(new Uint8Array([1, 2, 0, 3])).kind, 'unknown');
});

test('email by its headers', () => {
  const eml = 'From: Sender <s@example.com>\r\nTo: r@example.com\r\nSubject: Hello\r\nDate: Mon, 1 Jan 2024 00:00:00 +0000\r\n\r\nBody';
  assert.deepEqual(sniff(strToU8(eml)), { kind: 'eml', family: 'email' });
  assert.equal(sniff(strToU8('Subject: only one header\n\nbody')).kind, 'text');
});

test('legacy Office and Outlook files by their stream names', () => {
  const ole = (/** @type {string} */ stream) => {
    const head = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const name = [...stream].flatMap((c) => [c.charCodeAt(0), 0]);
    return new Uint8Array([...head, ...new Array(500).fill(0), ...name]);
  };
  assert.equal(sniff(ole('WordDocument')).kind, 'doc');
  assert.equal(sniff(ole('Workbook')).kind, 'xls');
  assert.equal(sniff(ole('PowerPoint Document')).kind, 'ppt');
  assert.deepEqual(sniff(ole('__substg1.0_0037001F')), { kind: 'msg', family: 'email' });
  assert.equal(sniff(ole('Nothing'), { filename: 'old.ppt' }).kind, 'ppt');
  assert.equal(sniff(ole('Nothing')).kind, 'unknown');
});

test('zip bombs are refused before anything is unpacked', () => {
  const bomb = zipSync({ 'word/document.xml': new Uint8Array(40 * 1024 * 1024), '[Content_Types].xml': strToU8('<x/>') });
  assert.ok(bomb.length < 200_000);
  assert.throws(() => sniff(bomb), { code: 'INVALID_INPUT', message: /zip bombs/ });
  assert.throws(() => checkZip(bomb, { maxSize: 1024 * 1024 }), { message: /more than 1 MB/ });
});

test('too many entries, paths that climb out, and broken zips are refused', () => {
  /** @type {Record<string, Uint8Array>} */
  const many = {};
  for (let i = 0; i < 30; i++) many[`f${i}.xml`] = strToU8('x');
  assert.throws(() => checkZip(zipSync(many), { maxEntries: 20 }), { message: /30 entries/ });
  assert.throws(() => checkZip(zipSync({ '../../etc/passwd': strToU8('x') })), { message: /climbs out/ });
  assert.throws(() => checkZip(strToU8('PK\u0003\u0004 not really a zip')), { message: /no zip directory/ });
  assert.equal(sniff(zipSync({ 'readme.txt': strToU8('hi') })).kind, 'unknown');
  assert.deepEqual(checkZip(zipSync({ 'a.txt': strToU8('hello') })).map((e) => [e.name, e.size]), [['a.txt', 5]]);
});
