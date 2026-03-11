// Core promises to run in browsers. Bundle it the way a browser app would and run the result,
// fetching pdfium.wasm over HTTP the way a browser does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { textDocument } from '@open-documents/fixtures';

const entry = fileURLToPath(new URL('../../packages/core/src/index.js', import.meta.url));
let dir = '';
let server;
let wasmUrl = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'od-bundle-'));
  const wasm = await readFile(new URL(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')));
  server = createServer((req, res) => {
    if (req.url !== '/pdfium.wasm') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/wasm' }).end(wasm);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  wasmUrl = `http://127.0.0.1:${server.address().port}/pdfium.wasm`;
});
after(async () => {
  server?.close();
  await rm(dir, { recursive: true, force: true });
});

test('bundles for the browser with no Node built-ins', async () => {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some((f) => f.endsWith('platform/browser.js')), 'the browser loader is used');
  assert.ok(!inputs.some((f) => f.endsWith('platform/node.js')), 'the Node loader is left out');
  assert.doesNotMatch(result.outputFiles[0].text, /from\s*["']node:/, 'no node: imports');
});

test('the browser bundle merges, splits and renders', async () => {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
  const file = join(dir, 'core.browser.js');
  await writeFile(file, result.outputFiles[0].text);
  const od = await import(pathToFileURL(file).href);
  od.configure({ wasmUrl });
  const a = await textDocument({ pages: 2, lines: (n) => [`A${n}`] });
  const b = await textDocument({ pages: 1, lines: () => ['B1'] });
  const merged = await od.merge([new Blob([a.bytes]), b.bytes]);
  assert.deepEqual((await od.extractText(merged)).map((p) => p.text), ['A1', 'A2', 'B1']);
  const parts = await od.split(merged);
  assert.equal(parts.length, 3);
  const png = await od.renderPage(parts[2], { width: 100 });
  assert.equal(png.width, 100);
});
