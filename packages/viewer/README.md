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
their page. Form fields can be filled in on the page or from code. With `design="true"`, a
toolbar adds new fields: pick text field, check box, dropdown, list or signature, drag a box on
the page (or click for a usual size), name it, and it is a real field (a signature field stays
empty, to be signed on the server). With `redact="true"`, mark areas on the pages and redact
them: what is under them is taken out of the document for good and the result is checked.
`save()` writes everything into the PDF.

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
await viewer.addFormFields([{ type: 'text', name: 'email', page: 1, x: 72, y: 600, width: 200, height: 20 }]);
const report = await viewer.redact({ text: ['Sam Sample'], areas: [{ page: 2, x: 72, y: 90, width: 200, height: 14 }] });
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
| `design` | `"true"` to draw new form fields on the pages |
| `redact` | `"true"` to mark areas and redact them |
| `fonts-url` | where you serve EmbedPDF's fallback fonts, for files that use Chinese, Japanese, Korean, Arabic or Hebrew fonts without including them. Nothing is fetched from anywhere else. |

Events: `od-load` `{ pageCount, name }`, `od-page` `{ page, pageCount }`,
`od-change` `{ type, page, annotation }` (`create`, `update` or `delete`; `ink`, `highlight`,
`text` and so on) or `{ type: 'pages', action, pages }` (`rotate`, `delete`, `move`) or
`{ type: 'field', page, name, value }` or `{ type: 'fields', action: 'add', names, pages }` or
`{ type: 'redaction', action: 'apply', pages, report }`, `od-error` `{ code, message }` (`PASSWORD_REQUIRED`, `DAMAGED_FILE`,
`ENGINE_ERROR`).

Style it from outside with `--od-height`, `--od-bg`, `--od-bar`, `--od-ink`, `--od-muted`,
`--od-line` and `--od-accent`, or the `toolbar`, `sidebar`, `annotation-toolbar`,
`field-toolbar` and `redaction-toolbar` parts.
