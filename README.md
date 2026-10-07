# Open Documents

A PDF toolkit you can put inside your own product.

Convert documents to PDF and back, split and reorder pages, stamp, annotate, fill forms, redact
and sign, from a JavaScript library, a self-hosted API or an embeddable viewer.

Commercial PDF SDKs are sold by quote. The most capable open source PDF engines are AGPL, which
many companies cannot ship. Open Documents is built only from permissively licensed parts, so
you can embed it in a closed-source product. Apache-2.0, checked on every change
(see [docs/licensing.md](docs/licensing.md)).

**Early.** The JavaScript library, the command line, the self-hosted server and the viewer work
today. The APIs may change before 1.0.

**Try it without writing code:** [examples/viewer](examples/viewer) is a small PDF editor that runs
on your own computer. Add text, highlights and drawings, fill in and add form fields, turn and
reorder pages, redact, then download the PDF or a Word file:

```sh
git clone https://github.com/capitalism-killed-software/open-documents.git
cd open-documents && npm ci
npm start -w open-documents-example-viewer      # then open http://127.0.0.1:5175/
```

Changing the words already in a PDF is not possible yet (see Planned).

## What works

```js
import { merge, split, rotate, watermark, pageNumbers, encrypt, renderPage } from '@open-documents/core';

const combined = await merge([contract, appendix], { bookmarks: true });
const pages = await split(combined);                          // one file per page
const turned = await rotate(scan, { angle: 90, pages: '2-last' });
const draft = await watermark(combined, { text: 'DRAFT' });
const numbered = await pageNumbers(draft, { format: 'Page {n} of {total}' });
const locked = await encrypt(numbered, { userPassword: 'open', permissions: { copy: false } });
const png = await renderPage(locked, { page: 1, dpi: 144, password: 'open' });
```

- **Read:** page sizes, rotation, metadata, security, forms, bookmarks; text and words with
  their positions; render pages to PNG
- **Pages:** merge, split, extract, remove, reorder, rotate, slice a page into pieces, crop,
  N-up, insert blank pages
- **Add to pages:** new text, watermarks, page numbers, headers and footers, Bates numbers,
  letterheads and backgrounds from another PDF (over or under the page); metadata, bookmarks
- **Forms:** read every field, fill them by name, add new ones, flatten
- **Signatures:** sign (PAdES, visible or not, into new or prepared fields, with an optional
  trusted timestamp) and check every signature in a file (pyHanko, in the Python worker)
- **Redaction:** areas, words and patterns taken out of the file for good (text, image pixels,
  drawings, form fields, metadata), then checked, with pictures of pages as the fallback
- **PDF/A:** make it from office files, web pages and images, fix up existing PDFs, and check
  them for the common problems
- **Compare:** the words that changed between two versions and where they are, how much each
  page changed, and a side-by-side report with the changes marked
- **Security:** AES-256 encryption with permissions, and removing it
- **Smaller files:** scans and photos scaled down to a target resolution and stored as JPEG or
  PNG (in the browser too); lossless compression, fast web view and repair (needs qpdf)
- **Out of PDF:** Word and PowerPoint that look like each page: every line of text is a text
  box you can edit, but text does not flow from one line to the next. Markdown, HTML and JSON
  with headings, lists and tables in reading order, and tables to Excel (Docling)
- **OCR:** make scanned PDFs searchable and read words with their positions, in Node or the
  browser (`@open-documents/ocr`, Tesseract in WebAssembly)
- **Convert to PDF:** Word, Excel, PowerPoint, OpenDocument, RTF, CSV, text, HTML, Markdown,
  email (`.eml` and Outlook `.msg`), web pages, JPEG, PNG, TIFF and other images (office files need LibreOffice, web pages
  need Chromium)

Input is a `Uint8Array`, `ArrayBuffer` or `Blob`, and every function returns new bytes.
See [docs/api.md](docs/api.md) for every option.

From the command line:

```sh
opendocs merge contract.pdf appendix.pdf -o both.pdf
opendocs split both.pdf --every 1 -o pages/
opendocs slice scan.pdf --columns 2          # a scanned spread into two pages
opendocs watermark both.pdf --text DRAFT
opendocs numbers both.pdf --format "Page {n} of {total}"
opendocs encrypt both.pdf --user-password open --no-copy
opendocs render both.pdf --page 2 --dpi 150 -o page2.png
opendocs convert report.docx                 # needs LibreOffice
opendocs to-docx report.pdf                  # and back to Word, each page as it looks
opendocs convert --url https://example.com -o page.pdf
opendocs compress big.pdf                    # needs qpdf
```

Run `opendocs --help` for the rest.

## The server

A REST API with the same operations, plus conversions, async jobs and signed webhooks. Run it
from the Docker image, which includes LibreOffice, Chromium and the fonts Office documents
expect:

```sh
docker build -f docker/Dockerfile -t open-documents .
KEY=$(openssl rand -hex 24)
docker run --rm -p 3000:3000 -e OPENDOCS_API_KEYS="$KEY" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges open-documents

curl -H "Authorization: Bearer $KEY" -F file=@report.docx http://localhost:3000/v1/convert -o report.pdf
```

See [docs/server.md](docs/server.md). `@open-documents/client` calls it from JavaScript with the
same function names as the library.

In the browser the engine runs on the page, so files never leave the computer: see
[examples/browser](examples/browser).

## The viewer

A PDF viewer for any web page, as a Web Component, so it works in plain HTML and in every
front-end framework: pages, thumbnails, zoom, search, text selection, annotations, form filling,
drawing new form fields, redacting, and turning, deleting and reordering pages.

```html
<script type="module" src="/od-viewer/od-viewer.js"></script>
<od-viewer src="/contract.pdf" wasm-url="/od-viewer/pdfium.wasm" open="true" download="true"></od-viewer>
```

The package's `dist/` folder holds that prebuilt file and `pdfium.wasm`; with a bundler, import
`@open-documents/viewer` instead. See [packages/viewer](packages/viewer),
[docs/frameworks.md](docs/frameworks.md) for React, Vue, Svelte and Angular, and
[examples/viewer](examples/viewer), the viewer as a small editor with every tool turned on.

## Planned

- **Edit:** images, links, existing text
- **To PDF:** EPUB
- **From PDF:** Word with flowing text
- **More:** annotations from code, full PDF/A validation (veraPDF), long-term signature
  validation (PAdES B-LT), fonts beyond Latin
- **Viewer:** drawing a handwritten signature

## Develop

Node 24 or newer.

```sh
npm ci
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md).

## Licence

Apache-2.0. Copyright Capitalism Killed Software. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
