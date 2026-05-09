# Viewer example

`<od-viewer>` on a page, with buttons that change the document through `@open-documents/core`
and show the result: rotate or delete the page in view, then download.

```sh
npm install          # from the repository root
npm start -w open-documents-example-viewer
```

Then open http://127.0.0.1:5174/. In your own app:

```html
<script type="module">import '@open-documents/viewer';</script>
<od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm"></od-viewer>
```
