# Open Documents

A PDF toolkit you can put inside your own product.

Convert documents to PDF and back, split and reorder pages, edit, annotate, fill forms, redact
and sign, from a JavaScript library, a self-hosted API or an embeddable editor.

Commercial PDF SDKs are sold by quote. The most capable open source PDF engines are AGPL, which
many companies cannot ship. Open Documents is built only from permissively licensed parts, so
you can embed it in a closed-source product. Apache-2.0, checked on every change
(see [docs/licensing.md](docs/licensing.md)).

**Early.** The JavaScript library, the command line and the self-hosted server work today.
Nothing is on npm yet.

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
- **Edit:** text, watermarks, page numbers, headers and footers, Bates numbers, metadata,
  bookmarks
- **Security:** AES-256 encryption with permissions, and removing it
- **Structure:** lossless compression, fast web view, repairing damaged files (needs qpdf)
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
docker run --rm -p 3000:3000 -e OPENDOCS_API_KEYS="$(openssl rand -hex 24)" \
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
and turning, deleting and reordering pages.

```html
<script type="module">import '@open-documents/viewer';</script>
<od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm"></od-viewer>
```

See [packages/viewer](packages/viewer), [docs/frameworks.md](docs/frameworks.md) for React, Vue, Svelte
and Angular, and [examples/viewer](examples/viewer), which changes the
document in view with the library and shows the result.

## Planned

- **Edit:** images, links, existing text
- **To PDF:** EPUB
- **From PDF:** Word, Excel, PowerPoint, HTML, Markdown, text, images
- **More:** annotations, forms, OCR, compare, smaller scans (lossy image compression), PDF/A,
  true redaction, digital signatures, fonts beyond Latin
- **Viewer:** signing, redaction, designing forms

## Develop

Node 24 or newer.

```sh
npm ci
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md).

## Licence

Apache-2.0. Copyright Capitalism Killed Software. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
