# Open Documents

A PDF toolkit you can put inside your own product.

Convert documents to PDF and back, split and reorder pages, edit, annotate, fill forms, redact
and sign, from a JavaScript library, a self-hosted API or an embeddable editor.

Commercial PDF SDKs are sold by quote. The most capable open source PDF engines are AGPL, which
many companies cannot ship. Open Documents is built only from permissively licensed parts, so
you can embed it in a closed-source product. Apache-2.0, checked on every change
(see [docs/licensing.md](docs/licensing.md)).

**Early.** The core reads, renders and extracts text today. It is not on npm yet.

## What works

```js
import { inspect, renderPage, extractText, extractWords, pageRanges } from '@open-documents/core';

const info = await inspect(bytes);                 // pages, sizes, rotation, metadata, forms, security
const png = await renderPage(bytes, { page: 1, dpi: 144 });
const text = await extractText(bytes, { pages: pageRanges('1-3,last', info.pageCount) });
const words = await extractWords(bytes);           // every word with its box, in points
```

Input is a `Uint8Array`, `ArrayBuffer` or `Blob`. Encrypted files take a `password` option.
Errors are `OpenDocumentsError` with a stable `code`.

From the command line:

```sh
opendocs info contract.pdf
opendocs render contract.pdf --page 2 --dpi 150 -o page2.png
opendocs text contract.pdf --pages 1-3
```

## Planned

- **Pages:** merge, split, slice, extract, reorder, rotate, crop, N-up, insert blank pages
- **Edit:** text, images, watermarks, page numbers, headers and footers, Bates numbers,
  metadata, bookmarks
- **To PDF:** Word, Excel, PowerPoint, OpenDocument, HTML and web pages, Markdown, images, email
- **From PDF:** Word, Excel, PowerPoint, HTML, Markdown, text, images
- **More:** annotations, forms, OCR, compare, compress, PDF/A, true redaction, digital
  signatures
- **Ways to use it:** the JavaScript library (browser and Node), a self-hosted API in Docker,
  and a viewer and editor component that works in any front-end framework

## Develop

Node 24 or newer.

```sh
npm ci
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/architecture.md](docs/architecture.md).

## Licence

Apache-2.0. Copyright Capitalism Killed Software. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
