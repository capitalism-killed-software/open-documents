# Browser example

Merge, split, rotate and watermark PDFs on a web page. The PDF engine runs in the page as
WebAssembly, so files never leave the computer.

```sh
npm install          # from the repository root
npm start -w open-documents-example-browser
```

Then open http://127.0.0.1:5174/.

The two lines that matter for your own app:

```js
import { configure, merge } from '@open-documents/core';
configure({ wasmUrl: '/pdfium.wasm' }); // serve node_modules/@embedpdf/pdfium/dist/pdfium.wasm
```
