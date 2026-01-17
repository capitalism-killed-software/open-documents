// Node only. Picked by the "#platform" import map in package.json.
import { readFile } from 'node:fs/promises';

/**
 * @param {{ wasmUrl?: string | URL }} settings
 * @returns {Promise<Uint8Array>}
 */
export async function loadWasm(settings) {
  const url = settings.wasmUrl ?? import.meta.resolve('@embedpdf/pdfium/pdfium.wasm');
  return readFile(new URL(url));
}
