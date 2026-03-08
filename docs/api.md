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
| `setMetadata(pdf, { title, author, subject, keywords, creator, producer, creationDate, modDate })` | Change the fields given; `null` clears one. |
| `setBookmarks(pdf, tree)` | Replace the outline. `[]` removes it. |

## Security

| Function | What it does |
|---|---|
| `encrypt(pdf, { userPassword, ownerPassword, permissions })` | AES-256. `permissions`: `print` (true, false or `"low"`), `modify`, `copy`, `annotate`, `fillForms`, `accessibility`, `assemble`. Without an owner password, a random one is made. |
| `decrypt(pdf, { password })` | Remove encryption. When the file restricts its readers, this needs the owner password. |

## Convert

| Function | What it does |
|---|---|
| `imagesToPdf([jpeg, png, ...], { pageSize, margin, dpi, orientation, title })` | One page per image, fitted and centred. `pageSize`: `"letter"` (default), `"a4"`, `"legal"`, `[w, h]` or `"fit"` (the image's own size at `dpi`). JPEG photos are turned by their EXIF orientation. |

Office documents, web pages and PDF to Word, Excel and other formats need the server, which is
not built yet.
