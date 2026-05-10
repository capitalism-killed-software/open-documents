# @open-documents/viewer

A PDF viewer for any web page, as a Web Component, so it works in plain HTML, React, Vue,
Svelte, Angular or anything else. Built on PDFium (the engine in Chrome) through EmbedPDF.
Nothing leaves the browser.

```sh
npm install @open-documents/viewer
```

Serve `node_modules/@embedpdf/pdfium/dist/pdfium.wasm` from your site, then:

```html
<script type="module">import '@open-documents/viewer';</script>
<od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm"></od-viewer>
```

Pages, thumbnails, zoom, page moves, search with highlights, text selection.

```js
const viewer = document.querySelector('od-viewer');
await viewer.load(fileOrBytesOrUrl, { password });   // resolves with { pageCount }
viewer.goToPage(3);
viewer.zoomIn(); viewer.zoomOut(); viewer.fitWidth();
const matches = await viewer.search('total due');
const bytes = await viewer.save();                     // the document as PDF bytes
viewer.addEventListener('od-page', (e) => console.log(e.detail.page, e.detail.pageCount));
```

| Attribute | |
|---|---|
| `src` | a PDF to open |
| `wasm-url` | where `pdfium.wasm` is served (required) |
| `sidebar` | `"true"` to show page thumbnails at start |
| `toolbar` | `"false"` to hide the toolbar |
| `fonts-url` | where you serve EmbedPDF's fallback fonts, for files that use Chinese, Japanese, Korean, Arabic or Hebrew fonts without including them. Nothing is fetched from anywhere else. |

Events: `od-load` `{ pageCount, name }`, `od-page` `{ page, pageCount }`,
`od-error` `{ code, message }` (`PASSWORD_REQUIRED`, `DAMAGED_FILE`, `ENGINE_ERROR`).

Style it from outside with `--od-height`, `--od-bg`, `--od-bar`, `--od-ink`, `--od-muted`,
`--od-line` and `--od-accent`, or the `toolbar` and `sidebar` parts.
