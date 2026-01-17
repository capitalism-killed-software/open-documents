// Browsers and other non-Node runtimes. Picked by the "#platform" import map in package.json.
import { OpenDocumentsError } from '../errors.js';

/**
 * Browsers cannot read files out of node_modules, so the app says where the WASM file is
 * served from. With Vite: `import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'`.
 *
 * @param {{ wasmUrl?: string | URL }} settings
 * @returns {Promise<Uint8Array>}
 */
export async function loadWasm(settings) {
  if (!settings.wasmUrl) {
    throw new OpenDocumentsError(
      'INVALID_OPTION',
      'In the browser, call configure({ wasmUrl }) with the URL of pdfium.wasm first.',
    );
  }
  const res = await fetch(settings.wasmUrl);
  if (!res.ok) {
    throw new OpenDocumentsError('ENGINE_ERROR', `Could not load pdfium.wasm: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
