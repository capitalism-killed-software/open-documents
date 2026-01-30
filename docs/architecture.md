# Architecture

## Packages

| Package | Runs in | What it does |
|---|---|---|
| `@open-documents/core` | browser and Node | Read, render and change PDFs. No Node-only imports outside `src/platform/node.js`. |
| `@open-documents/cli` | Node | The `opendocs` command, a thin layer over core. |
| `@open-documents/fixtures` | tests only | Generated PDFs with known contents. No real documents, ever. |

Planned: `@open-documents/node` (process pools for LibreOffice, Chromium and other tools),
`@open-documents/server` (self-hosted REST API and Docker image), `@open-documents/client`
(calls the API with the same function names as core), `@open-documents/viewer` (an embeddable
viewer and editor as Web Components), and a Python worker for the conversions that only exist
in Python.

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

## Untrusted files

Treat every input as hostile. Today: header check, a pixel cap on renders, page numbers
checked before use, and all engine memory freed in `finally` blocks. The server will add size
and page caps, timeouts, separate sandboxed processes for external tools, and no network access
for them.
