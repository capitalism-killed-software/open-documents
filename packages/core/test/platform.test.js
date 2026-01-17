import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWasm as loadInBrowser } from '../src/platform/browser.js';
import { loadWasm as loadInNode } from '../src/platform/node.js';

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

test('node finds pdfium.wasm in node_modules by itself', async () => {
  const bytes = await loadInNode({});
  assert.deepEqual([...bytes.subarray(0, 4)], WASM_MAGIC);
});

test('browser needs to be told where the wasm is', async () => {
  await assert.rejects(loadInBrowser({}), { code: 'INVALID_OPTION' });
});

test('browser fetches the wasm from the given url', async (t) => {
  t.mock.method(globalThis, 'fetch', async (/** @type {string} */ url) => {
    assert.equal(url, 'https://cdn.example/pdfium.wasm');
    return new Response(new Uint8Array(WASM_MAGIC));
  });
  const bytes = await loadInBrowser({ wasmUrl: 'https://cdn.example/pdfium.wasm' });
  assert.deepEqual([...bytes], WASM_MAGIC);
});

test('browser reports a failed download', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  await assert.rejects(loadInBrowser({ wasmUrl: 'https://cdn.example/missing.wasm' }), {
    code: 'ENGINE_ERROR',
    message: /HTTP 404/,
  });
});
