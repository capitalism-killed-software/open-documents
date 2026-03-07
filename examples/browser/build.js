// Bundle the example into dist/: the page, the script and pdfium.wasm next to it.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = (/** @type {string} */ p) => fileURLToPath(new URL(p, import.meta.url));
await mkdir(here('dist'), { recursive: true });
await build({
  entryPoints: [here('main.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  outfile: here('dist/app.js'),
  logLevel: 'info',
});
await copyFile(here('index.html'), here('dist/index.html'));
await copyFile(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')), here('dist/pdfium.wasm'));
