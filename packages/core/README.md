# @open-documents/core

Read, render and change PDF files, in the browser and in Node. Apache-2.0, nothing AGPL or GPL
underneath. The engine is PDFium, the PDF engine in Chrome, compiled to WebAssembly.

```sh
npm install @open-documents/core
```

```js
import { merge, split, rotate, watermark, pageNumbers, encrypt, extractText, renderPage } from '@open-documents/core';

const both = await merge([contract, appendix], { bookmarks: true });
const pages = await split(both);                                   // one file per page
const draft = await watermark(both, { text: 'DRAFT' });
const numbered = await pageNumbers(draft, { format: 'Page {n} of {total}' });
const locked = await encrypt(numbered, { userPassword: 'open', permissions: { copy: false } });
const text = await extractText(locked, { password: 'open' });
const png = await renderPage(both, { page: 1, dpi: 144 });
```

Input is a `Uint8Array`, `ArrayBuffer` or `Blob`; every function returns new bytes. Pages,
merge, split, slice, crop, N-up, text, words with positions, page images, watermarks, page and
Bates numbers, headers and footers, overlays and underlays from another PDF, forms (read, fill,
add fields, flatten), metadata,
bookmarks, AES-256 encryption, images to PDF, PDF to Word and PowerPoint.

In a browser, serve `node_modules/@embedpdf/pdfium/dist/pdfium.wasm` and say where:

```js
import { configure } from '@open-documents/core';
configure({ wasmUrl: '/pdfium.wasm' });
```

Every option: [docs/api.md](https://github.com/capitalism-killed-software/open-documents/blob/main/docs/api.md).
