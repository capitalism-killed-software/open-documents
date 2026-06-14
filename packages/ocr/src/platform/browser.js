// In a browser nothing is fetched from anyone else's server: the page says where the worker,
// the WebAssembly core and the language data are served from. tesseract.js would otherwise load
// all three from a public CDN.
import { OpenDocumentsError } from '@open-documents/core';

/**
 * @param {string[]} languages
 * @param {{ langPath?: string }} options
 * @returns {{ options: Record<string, string>, close: () => void }}
 */
export function languageData(languages, options) {
  if (!options.langPath) {
    throw new OpenDocumentsError('ENGINE_MISSING', `In a browser, serve the language data (${languages.map((c) => `${c}.traineddata.gz`).join(', ')}) and pass langPath, the URL of its folder.`);
  }
  return { options: { langPath: options.langPath }, close() {} };
}

/**
 * @param {{ workerPath?: string, corePath?: string }} options
 * @returns {Record<string, string>}
 */
export function workerPaths(options) {
  if (!options.workerPath || !options.corePath) {
    throw new OpenDocumentsError('ENGINE_MISSING', 'In a browser, serve tesseract.js/dist/worker.min.js and the tesseract.js-core folder, and pass workerPath and corePath.');
  }
  return { workerPath: options.workerPath, corePath: options.corePath };
}

/** tesseract.js takes a Blob in the browser. @param {Uint8Array} png */
export const imageInput = (png) => new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (png)], { type: 'image/png' });
