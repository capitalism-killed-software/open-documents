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

Pages, thumbnails, zoom, page moves, search with highlights, text selection, and with
`annotate="true"` a second toolbar for highlights, underlines, strike-outs, pen drawing, text
boxes, notes and boxes, with undo and redo. With `organize="true"`, the thumbnails get buttons
to turn and delete pages, and can be dragged to put pages in a new order; annotations go with
their page. Form fields can be filled in on the page or from code. `save()` writes everything
into the PDF.

```js
const viewer = document.querySelector('od-viewer');
await viewer.load(fileOrBytesOrUrl, { password });   // resolves with { pageCount }
viewer.goToPage(3);
viewer.zoomIn(); viewer.zoomOut(); viewer.fitWidth();
const matches = await viewer.search('total due');
const bytes = await viewer.save();                     // the document as PDF bytes
viewer.setTool('highlight');                           // or 'ink', 'freeText', 'textComment', null
viewer.undo(); viewer.redo();
await viewer.rotatePages([2], 90); await viewer.deletePages([4]); await viewer.movePage(5, 1);
viewer.formFields();                                   // [{ name, type, value, readOnly, options }]
viewer.getFormValues();                                // { name: 'Sample Person', agree: 'Yes' }
await viewer.setFormValues({ notes: 'Filled in', colour: 'blue' });
viewer.addEventListener('od-page', (e) => console.log(e.detail.page, e.detail.pageCount));
viewer.addEventListener('od-change', (e) => console.log(e.detail.type, e.detail.annotation));
```

| Attribute | |
|---|---|
| `src` | a PDF to open |
| `wasm-url` | where `pdfium.wasm` is served (required) |
| `sidebar` | `"true"` to show page thumbnails at start |
| `toolbar` | `"false"` to hide the toolbar |
| `annotate` | `"true"` to show the annotation tools |
| `author` | the name written into new annotations |
| `organize` | `"true"` to turn, delete and move pages from the thumbnails |
| `fonts-url` | where you serve EmbedPDF's fallback fonts, for files that use Chinese, Japanese, Korean, Arabic or Hebrew fonts without including them. Nothing is fetched from anywhere else. |

Events: `od-load` `{ pageCount, name }`, `od-page` `{ page, pageCount }`,
`od-change` `{ type, page, annotation }` (`create`, `update` or `delete`; `ink`, `highlight`,
`text` and so on) or `{ type: 'pages', action, pages }` (`rotate`, `delete`, `move`) or
`{ type: 'field', page, name, value }`, `od-error` `{ code, message }` (`PASSWORD_REQUIRED`, `DAMAGED_FILE`,
`ENGINE_ERROR`).

Style it from outside with `--od-height`, `--od-bg`, `--od-bar`, `--od-ink`, `--od-muted`,
`--od-line` and `--od-accent`, or the `toolbar` and `sidebar` parts.
