// Where Tesseract finds its language data in Node: the @tesseract.js-data/<code> packages, or a
// folder the caller names. tesseract.js reads every language from one folder, so when the
// packages sit in separate folders their files are linked into a private temporary one.
import { createRequire } from 'node:module';
import { mkdtempSync, linkSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { OpenDocumentsError } from '@open-documents/core';

const require = createRequire(import.meta.url);

/**
 * @param {string[]} languages
 * @param {{ langPath?: string }} options
 * @param {(code: string) => string} [find]  where a language's file is; the package by default
 * @returns {{ options: Record<string, string>, close: () => void }}
 */
export function languageData(languages, options, find = packageFile) {
  if (options.langPath) {
    for (const code of languages) {
      if (!existsSync(join(options.langPath, `${code}.traineddata.gz`))) {
        throw new OpenDocumentsError('ENGINE_MISSING', `No ${code}.traineddata.gz in ${options.langPath}.`);
      }
    }
    return { options: { langPath: options.langPath }, close() {} };
  }
  const files = languages.map(find);
  const folders = new Set(files.map((f) => dirname(f)));
  if (folders.size === 1) return { options: { langPath: [...folders][0] }, close() {} };
  const folder = mkdtempSync(join(tmpdir(), 'open-documents-tessdata-'));
  for (const file of files) linkOrCopy(file, join(folder, basename(file)));
  return { options: { langPath: folder }, close: () => rmSync(folder, { recursive: true, force: true }) };
}

/** @param {string} code */
function packageFile(code) {
  let manifest;
  try {
    manifest = require.resolve(`@tesseract.js-data/${code}/package.json`);
  } catch {
    throw new OpenDocumentsError('ENGINE_MISSING', `No language data for "${code}". Install @tesseract.js-data/${code}, or pass langPath: a folder holding ${code}.traineddata.gz.`);
  }
  return join(dirname(manifest), '4.0.0_best_int', `${code}.traineddata.gz`);
}

/**
 * A hard link costs nothing; it fails across disks and on some file systems, then copy.
 *
 * @param {string} from
 * @param {string} to
 * @param {(from: string, to: string) => void} [link]
 */
export function linkOrCopy(from, to, link = linkSync) {
  try {
    link(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

/** tesseract.js finds its worker and WebAssembly next to itself in Node. */
export const workerPaths = () => ({});

/** tesseract.js takes a Buffer in Node. @param {Uint8Array} png */
export const imageInput = (png) => Buffer.from(png.buffer, png.byteOffset, png.byteLength);
