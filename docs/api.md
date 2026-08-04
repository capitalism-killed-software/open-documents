# API

Everything is in `@open-documents/core` and works the same in Node and in browsers.

- **Input** is a PDF as a `Uint8Array`, `ArrayBuffer` or `Blob`.
- **Output** is a new `Uint8Array`. Inputs are never changed.
- **Pages** are numbered from 1. Where a function takes `pages`, give an array (`[1, 3]`) or
  a page list (`"1-3,5,8-last"`, `"odd"`, `"even"`, `"all"`). Leaving it out means every page.
- **Points**: sizes and positions are in points, 1/72 inch, measured on the page as a viewer
  shows it: from the top left, with rotation applied.
- **Encrypted files** take a `password` option. Operations that change a file keep its
  encryption; operations that build a new file (extract, merge, split, slice) do not.
- **Errors** are `OpenDocumentsError` with a stable `code`: `INVALID_INPUT`,
  `INVALID_OPTION`, `PASSWORD_REQUIRED`, `UNSUPPORTED_SECURITY`, `DAMAGED_FILE`,
  `PAGE_NOT_FOUND`, `ENGINE_ERROR`.

In a browser, say where `pdfium.wasm` is served from before the first call:

```js
import { configure } from '@open-documents/core';
configure({ wasmUrl: '/pdfium.wasm' });
```

## Read

| Function | Returns |
|---|---|
| `inspect(pdf)` | page count, each page's size and rotation, PDF version, metadata, whether it is encrypted, permissions, forms, signatures, attachments, bookmarks, tagged |
| `extractText(pdf, { pages })` | `[{ page, text }]`, lines separated by `\n` |
| `extractWords(pdf, { pages })` | `[{ page, width, height, words: [{ text, x, y, width, height }] }]` |
| `getBookmarks(pdf)` | the outline as a tree: `[{ title, page, children }]` |
| `pageRanges("1-3,last", pageCount)` | `[1, 2, 3, pageCount]` |

## Render

| Function | Options |
|---|---|
| `renderPage(pdf, options)` | `page`, `dpi` (default 96) or `width` in pixels, `format` (`"png"` or `"rgba"`), `background` (`"#rrggbb"`, `"#rrggbbaa"` or `"transparent"`), `annotations` (default true), `maxPixels` (default 40 million) |
| `renderPages(pdf, options)` | the same, with `pages` instead of `page` |
| `thumbnails(pdf, { pages, width })` | PNGs, 200 pixels wide by default |

Each result is `{ page, width, height, format, data }`.

## Pages

| Function | What it does |
|---|---|
| `merge([a, b, ...], { bookmarks })` | Join documents. Each item can be a PDF or `{ input, pages, password, title }`. With `bookmarks: true`, adds one bookmark per document. |
| `split(pdf, { every \| ranges \| at })` | Cut into several documents. Default: one per page. `every: 3`, `ranges: ["1-3", "4-last"]` or `at: [4, 9]`. Returns an array. |
| `extractPages(pdf, pages)` | A new document with those pages, in that order. Repeats allowed. |
| `removePages(pdf, pages)` | Drop pages. Refuses to remove them all. |
| `reorder(pdf, order)` | Every page exactly once in a new order, e.g. `[3, 1, 2]` or `"last-1"`. |
| `rotate(pdf, { angle, pages })` | Turn clockwise by 90, 180 or 270 (negative for anticlockwise), on top of any rotation the page has. |
| `slicePages(pdf, { columns, rows, pages })` | Cut each page into pieces, each a page of its own. Default: two halves side by side. |
| `crop(pdf, { margins \| box, pages })` | Hide the edges. `margins: 36` or `{ top, right, bottom, left }`; or `box: { x, y, width, height }` to keep. Trimmed content is hidden, not removed. |
| `nUp(pdf, { columns, rows, pageSize })` | Several pages per sheet. Default: two per landscape sheet. |
| `insertBlankPages(pdf, { at, count, size })` | Blank pages that start at page number `at`. |

## Edit

All text functions take `font` (one of the 12 standard fonts: Helvetica, Times, Courier and their
bold and italic styles), `size`, `color` (`"#rrggbb"`), `opacity` (0 to 1) and `pages`.
The standard fonts draw Latin text only; anything else is refused rather than drawn as blanks.

| Function | What it does |
|---|---|
| `addText(pdf, { text, at \| position, margin, angle })` | Text at a point (`at: { x, y }`, top left of the text) or one of nine positions: `top-left`, `top-center`, `top-right`, `center-left`, `center`, `center-right`, `bottom-left`, `bottom-center`, `bottom-right`. |
| `watermark(pdf, { text, angle, position, behind })` | Large, faint, slanted text. Defaults: 64pt Helvetica-Bold, grey, 25% opacity, 45 degrees. `behind: true` blends it so dark content shows through. |
| `pageNumbers(pdf, { format, start, position, margin })` | `format` uses `{n}` and `{total}`, e.g. `"Page {n} of {total}"`. Counts only the selected pages. |
| `headerFooter(pdf, { header, footer, start, title })` | Each of `header` and `footer` has `left`, `center` and `right`, using `{n}`, `{total}` and `{title}`. |
| `bates(pdf, { prefix, suffix, start, digits, position })` | Running labels like `ACME-000123`. |
| `overlay(pdf, layer, { pages, fit, behind })` | Draw the pages of another PDF on the pages: a letterhead, a background, a template. A one-page layer goes on every page; otherwise one layer page per selected page, in order. `fit`: `"contain"` (default, keeps proportions, centred) or `"stretch"`. `behind: true` puts it under the content; the page's own content moves into a form, which a tagged PDF's structure tree no longer reaches. |
| `setMetadata(pdf, { title, author, subject, keywords, creator, producer, creationDate, modDate })` | Change the fields given; `null` clears one. |
| `setBookmarks(pdf, tree)` | Replace the outline. `[]` removes it. |

## Forms

Filled the way a person fills them, through PDFium's own form filler, so each value and the
way it looks stay in step, and the file keeps its encryption.

| Function | What it does |
|---|---|
| `getFormFields(pdf, { password })` | Every field: `{ name, type, value, options, readOnly, required, multiline, widgets }`. `type` is `text`, `checkbox`, `radio`, `dropdown`, `list`, `signature` or `button`. `value` is the text, `true`/`false` for a check box, the chosen export value for a radio group (or `null`), the chosen options for a list. `widgets` says where the field appears: `{ page, x, y, width, height }` in points as shown, plus `exportValue` for check boxes and radio buttons. |
| `fillForm(pdf, values, { flatten, password })` | Fill by name: `{ name: 'Sam', agree: true, colour: 'blue' }`. Every name and value is checked before anything changes. Read-only fields can be filled from code. `flatten: true` then makes the values part of the pages. |
| `addFormFields(pdf, fields, { password })` | New fields: `{ type, name, page, x, y, width, height, value, options, required, readOnly, multiline, multiple, fontSize }`, with `type` one of `text`, `checkbox`, `dropdown`, `list`. Names must be new and have no dots. On a turned page the field is placed where it is asked for as shown; its text runs the way the page's own content does. |
| `flatten(pdf, { pages, password })` | Fields and annotations become part of the pages: they look the same and can no longer be changed. When no field is left, the form itself is removed. |

## Security

| Function | What it does |
|---|---|
| `encrypt(pdf, { userPassword, ownerPassword, permissions })` | AES-256. `permissions`: `print` (true, false or `"low"`), `modify`, `copy`, `annotate`, `fillForms`, `accessibility`, `assemble`. Without an owner password, a random one is made. |
| `decrypt(pdf, { password })` | Remove encryption. When the file restricts its readers, this needs the owner password. |

## Convert

| Function | What it does |
|---|---|
| `imagesToPdf([jpeg, png, ...], { pageSize, margin, dpi, orientation, title })` | One page per image, fitted and centred. `pageSize`: `"letter"` (default), `"a4"`, `"legal"`, `[w, h]` or `"fit"` (the image's own size at `dpi`). JPEG photos are turned by their EXIF orientation. |

## Out of PDF

Both keep each page's layout exactly: every stretch of text becomes a text box where it was, in
its font (mapped to the family office suites know, such as Arial for Helvetica), size, weight,
slant and colour, and everything that is not text (pictures, lines, shading) becomes one
picture behind it. The text can be edited and searched; it does not reflow the way typed text
does. Words far apart on a line, such as table columns, get boxes of their own. Converted back
to PDF by LibreOffice, words land within a point and a half of where they were.

| Function | What it does |
|---|---|
| `toDocx(pdf, { pages, background, dpi, password })` | Word. Each page becomes a section of its own size; turned pages come out landscape. Pages over 22 inches are scaled to fit, Word's limit. |
| `toPptx(pdf, { pages, background, dpi, password })` | PowerPoint, one slide per page. The first page sets the slide size; pages of other sizes are scaled to fit and centred. |

`background`: `"auto"` (the default) draws the picture, except on pages whose text is invisible,
a scan with an OCR text layer, where it would show every word twice; `true` always; `false`
never. `dpi` is the picture's resolution, 36 to 300, default 150. Fonts are not embedded: a
reader without the font uses a similar one, and the text may run a little longer or shorter.

## Conversions and structure (Node)

`@open-documents/node` adds what needs other programs. LibreOffice, Chromium and qpdf start the
first time they are needed.

```js
import { createConverter } from '@open-documents/node';
const converter = createConverter();
const pdf = await converter.toPdf(bytes, { filename: 'report.docx' });
await converter.close();
```

| Method | What it does |
|---|---|
| `toPdf(file, options)` | Any supported file to PDF: Word, Excel, PowerPoint, OpenDocument, RTF, CSV, text (LibreOffice); HTML, Markdown, `.eml` and Outlook `.msg` (Chromium); JPEG and PNG (no other program); TIFF, GIF, WebP, BMP (LibreOffice). `filename` helps with CSV, Markdown and text. Layout options as below. |
| `htmlToPdf(html, { assets, javascript, ... })` | `assets` are the files the HTML refers to by relative path. Scripts are off unless `javascript: true`. The page cannot reach the network. |
| `markdownToPdf(markdown, { allowHtml, ... })` | With a clean print style. Raw HTML in the Markdown shows as text unless `allowHtml`. |
| `urlToPdf(url, { allowHosts, ... })` | A live page, through a proxy that refuses private addresses. |
| `compress(pdf, { password })` | Smaller, losing nothing (qpdf). Images are left as they are. |
| `linearize(pdf, { password })` | Fast web view (qpdf). |
| `repair(pdf, { password })` | Rebuild a damaged file (qpdf). |

Layout options for HTML, Markdown, email and web pages: `format` (`letter`, `a4`, `legal`, `a3`,
`a5`, `tabloid`), `size: { width, height }` as CSS lengths, `landscape`, `margin`, `scale`,
`background`, `header` and `footer` (HTML, with `pageNumber` and `totalPages` classes).

### Structure: Markdown, HTML, JSON and Excel (Docling)

Docling (MIT) reads what a page is made of: headings, paragraphs, lists, tables and reading
order, with a layout model and a table model. It runs in a small Python worker that ships with
this package, started on first use and kept running.

Set it up once (needs [uv](https://docs.astral.sh/uv/)). The models are about 500 MB:

```sh
cd node_modules/@open-documents/node/python
uv sync --frozen
uv run docling-tools models download layout tableformer -o ~/.cache/open-documents/docling-models
```

| Method | What it does |
|---|---|
| `pdfToMarkdown(pdf, { pages, password, timeout })` | Markdown with headings, lists and tables, in reading order. |
| `pdfToHtml(pdf, options)` | One HTML page with the same structure. |
| `pdfToJson(pdf, options)` | Docling's document model: every text, table and picture with its page and box. |
| `pdfToXlsx(pdf, options)` | Every table in its own sheet, named after its page. Cells that are plain numbers are stored as numbers. Fails with `CONVERSION_FAILED` when there are no tables. |

Scanned pages need a text layer first: run `ocr()` from `@open-documents/ocr`, then these.
Docling's own OCR is off, and it never reaches the network: Hugging Face downloads are turned
off and the models are read from their folder. Settings: `createConverter({ docling: { python,
models, timeout, maxJobs } })`, or `OPENDOCS_PYTHON` and `OPENDOCS_DOCLING_MODELS`.

## OCR

`@open-documents/ocr` reads text off scanned pages with Tesseract, compiled to WebAssembly, in
Node and in browsers.

```js
import { createOcr } from '@open-documents/ocr';
const reader = await createOcr({ languages: ['eng'], workers: 2 });
const searchable = await reader.ocr(scan);
const pages = await reader.recognize(scan, { pages: [1] });
await reader.close();
```

`ocr(pdf, options)` and `recognize(pdf, options)` also work on their own; they start and stop
their own Tesseract, which takes about a second.

| Engine option | What it does |
|---|---|
| `languages` | Tesseract codes, default `["eng"]`. English data comes with the package; for others install `@tesseract.js-data/<code>` or use `langPath`. |
| `workers` | Pages read at the same time, 1 to 16; default 2. Each takes about 100 MB. |
| `langPath` | A folder (Node) or URL (browser) holding `<code>.traineddata.gz`. |
| `workerPath`, `corePath` | Browser only, and required there: where you serve `tesseract.js/dist/worker.min.js` and the `tesseract.js-core` folder. Nothing is fetched from a CDN. |

| Method | What it does |
|---|---|
| `ocr(pdf, { pages, dpi, force, onPage, password })` | Read the pages that have no text and put what was read back onto them as invisible text, exactly over the words. The pages look the same. A page with 20 or more characters of text counts as having text and is skipped unless `force: true`. `dpi` (100 to 600, default 300) is how finely pages are drawn for reading. `onPage` hears `{ page, skipped, confidence }` as each page is done. Encryption is kept. |
| `recognize(pdf, { pages, dpi, password })` | The words on each page as `{ page, width, height, text, confidence, words }`, each word `{ text, x, y, width, height, confidence }` in points as shown, confidence 0 to 100. |

Errors add `ENGINE_MISSING` (no data for a language, or a browser without the paths) and
`CONVERSION_FAILED` (Tesseract could not read a page).
