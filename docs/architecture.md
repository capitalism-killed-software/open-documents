# Architecture

## Packages

| Package | Runs in | What it does |
|---|---|---|
| `@open-documents/core` | browser and Node | Read, render and change PDFs. No Node-only imports outside `src/platform/node.js`. |
| `@open-documents/node` | Node | Conversions that need other programs: LibreOffice for office files, Chromium for HTML, Markdown, email and web pages, with the egress proxy and file-type checks; Docling in a Python worker (`python/`) for document structure. |
| `@open-documents/server` | Node | The REST API (Fastify): operations, conversions, jobs, webhooks, API keys. `docker/` builds its image. |
| `@open-documents/client` | browser and Node | Calls the API with the same function names as core. |
| `@open-documents/cli` | Node | The `opendocs` command, a thin layer over core and node. |
| `@open-documents/fixtures` | tests only | Generated PDFs, Office files, images and email with known contents. No real documents, ever. |

| `@open-documents/ocr` | browser and Node | Tesseract (tesseract.js, WebAssembly) in a small worker pool. Pages are drawn by core, read, and the text goes back on as an invisible layer through core's `overlay`. |
| `@open-documents/viewer` | browser | `<od-viewer>`, a Web Component on EmbedPDF's headless plugins, laid out with Preact and htm inside a shadow root. |

## Engines

Core uses two engines behind one API:

- **PDFium**, the PDF engine in Chrome, compiled to WebAssembly (`@embedpdf/pdfium`). It renders
  pages, reads text with positions, reads and writes annotations and forms, imports pages
  between documents and saves. It is tolerant of damaged files.
- **pdf-lib** (the maintained `@cantoo/pdf-lib` fork) for building content in JavaScript:
  stamping text and images, creating form fields.

PDFium is single-threaded and every call into it is synchronous. `Engine.withDocument()` opens
a document, runs a synchronous callback and always closes it and frees its memory. Nothing awaits
in between, so calls cannot interleave. In the browser the engine will move into a Web Worker so
the page stays responsive; the public API is already async for that reason.

## Coordinates

Sizes and boxes are in points (1/72 inch). Word boxes and page sizes are given as a viewer
shows the page: rotation applied, origin at the top left. Multiply by `dpi / 72` to land on a
rendered image.

## Errors

Every error thrown on purpose is an `OpenDocumentsError` with a stable `code`
(`INVALID_INPUT`, `INVALID_OPTION`, `PASSWORD_REQUIRED`, `UNSUPPORTED_SECURITY`,
`DAMAGED_FILE`, `PAGE_NOT_FOUND`, `ENGINE_ERROR`). Branch on the code, not the message.

## Converters

`createConverter()` works out what a file is from its bytes (`sniff`) and sends it on:

- PDF: returned as it is.
- JPEG and PNG: core's `imagesToPdf`, no other program needed.
- Office files, CSV, text, TIFF, GIF, WebP, BMP: LibreOffice, headless. A small pool of slots,
  each with its own locked-down profile; one document per slot at a time.
- HTML, Markdown, email: Chromium with the network off. Markdown becomes HTML with a print
  style; email becomes a page with its headers on top and its inline pictures served from the
  message.
- Web pages: Chromium through the egress proxy.

LibreOffice and Chromium start the first time they are needed.

## Untrusted files

Treat every input as hostile:

- type checks from the bytes, and zip directories checked before anything is unpacked;
- caps on file size, file count, render size and run time;
- every external program in its own process group, killed with everything it started when it
  runs too long, and given a minimal environment;
- no network for uploaded HTML; private addresses refused for web pages and webhooks;
- all engine memory freed in `finally` blocks.

Planned: each converter in its own sandbox (nsjail) inside the image.
