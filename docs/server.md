# The server

A self-hosted REST API: everything in `@open-documents/core`, plus conversions that need other
programs (LibreOffice for office files, Chromium for web pages). Your files stay on your
machines.

## Run it

With Docker, built from this repository. `docker/Dockerfile.full` adds Docling for Markdown,
HTML, JSON and Excel, about two gigabytes more:

```sh
docker build -f docker/Dockerfile -t open-documents .
docker run --rm -p 3000:3000 \
  -e OPENDOCS_API_KEYS="$(openssl rand -hex 24)" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  open-documents
```

The flags on the second line are recommended: the converters then run with no way to change the
image, no extra privileges and nothing written outside `/tmp`. CI runs the image exactly like
this on every change.

Without Docker, with LibreOffice and qpdf installed and Chromium fetched by Playwright:

```sh
npm ci
npx playwright-core install chromium
npx opendocs-server           # listens on 127.0.0.1:3000
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Where to listen. The image uses `0.0.0.0`. |
| `OPENDOCS_API_KEYS` | none | Comma-separated keys, each at least 16 characters. Callers send `Authorization: Bearer <key>`. The server refuses to listen beyond this machine without keys, unless `OPENDOCS_ALLOW_NO_AUTH=1` says something in front of it already checks callers. |
| `OPENDOCS_MAX_FILE_MB` | `50` | Largest file accepted. |
| `OPENDOCS_ALLOW_URL` | off | `1` turns on web page conversion. |
| `OPENDOCS_ALLOW_HOSTS` | none | Comma-separated private hosts that web pages and webhooks may reach, such as an intranet wiki. Callers cannot add to this list. |
| `OPENDOCS_WEBHOOK_SECRET` | none | Signs webhooks. Webhooks are refused without it. |
| `OPENDOCS_SOFFICE` | found on the PATH | Path to LibreOffice's `soffice`. |
| `OPENDOCS_CHROMIUM` | Playwright's build | Path to a Chromium executable. |
| `OPENDOCS_QPDF` | found on the PATH | Path to `qpdf`. |
| `OPENDOCS_OCR_LANGUAGES` | `eng` | What OCR reads, comma-separated Tesseract codes such as `eng,deu`. Each needs its data: the `@tesseract.js-data/<code>` package, or a file in `OPENDOCS_OCR_LANG_PATH`. Requests cannot add languages. |
| `OPENDOCS_OCR_WORKERS` | `2` | Pages read at the same time. Each takes about 100 MB. |
| `OPENDOCS_OCR_LANG_PATH` | the npm packages | A folder holding `<code>.traineddata.gz` files. |
| `OPENDOCS_PYTHON`, `OPENDOCS_DOCLING_MODELS` | set in the full image | A Python with Docling and its model folder, for the structure operations. |
| `OPENDOCS_WORK_DIR` | the system temp folder | Where LibreOffice profiles and job files go. |
| `OPENDOCS_LOG` | `info` | Log level, or `0` for none. |

## Requests

Upload files as multipart form data. Put settings in an `options` field as JSON; they are the
same options the library takes (see [api.md](api.md)).

```sh
curl -H "Authorization: Bearer $KEY" -F file=@contract.pdf -F 'options={"angle":90,"pages":"2-last"}' \
  http://localhost:3000/v1/pdf/rotate -o rotated.pdf
```

### PDF operations: `POST /v1/pdf/<name>`

| Name | Returns |
|---|---|
| `inspect`, `text`, `words`, `bookmarks` | JSON |
| `render`, `thumbnails` | a PNG for one page, a zip of PNGs for several |
| `merge` (several files; `items` in options gives each one `pages` or `password`), `extract-pages`, `remove-pages`, `reorder`, `rotate`, `slice`, `crop`, `n-up`, `insert-blank-pages` | PDF |
| `split` | a zip of PDFs |
| `add-text`, `watermark`, `page-numbers`, `header-footer`, `bates`, `metadata`, `set-bookmarks` | PDF |
| `overlay` (two files: the document, then the layer; `pages`, `fit`, `behind`) | PDF |
| `to-docx`, `to-pptx` (`pages`, `background`, `dpi`) | Word or PowerPoint with each page's layout kept |
| `to-markdown`, `to-html` (`pages`) | Markdown or HTML with the document's structure; needs Docling, which the full image includes |
| `to-json`, `to-xlsx` (`pages`) | Docling's document model, or the tables as a workbook |
| `ocr` (`pages`, `dpi`, `force`) | PDF with the scanned pages made searchable. OCR starts on the first request, which takes a second longer. |
| `recognize` (`pages`, `dpi`) | JSON: the words read on each page, with positions and confidence |
| `encrypt`, `decrypt` | PDF |
| `compress` (lossless), `linearize` (fast web view), `repair` | PDF; these need qpdf, which the image includes |
| `images-to-pdf` (several JPEG or PNG files) | PDF |

`GET /v1/operations` lists them.

### Conversions

| Endpoint | Body |
|---|---|
| `POST /v1/convert` | one file: Word, Excel, PowerPoint, OpenDocument, RTF, CSV, text, HTML, Markdown, email (`.eml` and Outlook `.msg`), JPEG, PNG, TIFF, GIF, WebP, BMP |
| `POST /v1/convert/html` | JSON `{ "html": "...", "options": {} }`, or multipart with `index.html` and the files it uses (`logo.png`, `css/print.css` and so on) |
| `POST /v1/convert/markdown` | JSON `{ "markdown": "...", "options": {} }` |
| `POST /v1/convert/url` | JSON `{ "url": "https://...", "options": {} }`; only when `OPENDOCS_ALLOW_URL=1` |

Layout options for HTML, Markdown, email and web pages: `format` (`letter`, `a4`, `legal`,
`a3`, `a5`, `tabloid`), `size` (`{ "width": "4in", "height": "6in" }`), `landscape`, `margin`,
`scale`, `background`, `header`, `footer`. HTML runs no scripts unless `javascript: true`.

### Errors

Errors are JSON with a stable code: `{ "error": { "code": "PASSWORD_REQUIRED", "message": "..." } }`.

| Status | Codes |
|---|---|
| 400 | `INVALID_INPUT`, `INVALID_OPTION`, `PAGE_NOT_FOUND`, `BAD_REQUEST` |
| 401 | `UNAUTHORIZED` |
| 403 | `BLOCKED` (a page or webhook tried to reach a private address), `URL_DISABLED` |
| 404 | `NOT_FOUND` (jobs) |
| 409 | `NOT_READY` (job results) |
| 413 | `TOO_LARGE`, `TOO_MANY_FILES` |
| 422 | `PASSWORD_REQUIRED`, `UNSUPPORTED_SECURITY`, `DAMAGED_FILE`, `CONVERSION_FAILED` |
| 501 | `ENGINE_MISSING` (LibreOffice, Chromium or qpdf is not installed) |
| 503 | `BUSY` |
| 504 | `TIMEOUT` |

## Jobs and webhooks

Send `Prefer: respond-async` and the server answers `202` straight away with a job:

```json
{ "id": "…", "status": "queued", "links": { "self": "/v1/jobs/…", "result": "/v1/jobs/…/result" } }
```

Poll `self` until `status` is `done` or `failed`, then fetch `result`. Jobs and their results
are kept in memory for an hour after they finish, and only the API key that made a job can read
it.

Add `"webhook": "https://your.app/hooks/pdf"` to the options (this also makes the request a
job) and the server POSTs to it when the job finishes:

```json
{ "id": "…", "status": "done", "error": null, "result": "https://…/v1/jobs/…/result" }
```

with the header `Opendocs-Signature: t=<unix seconds>,v1=<hex>`, where the hex is
HMAC-SHA256 of `"<t>.<body>"` with `OPENDOCS_WEBHOOK_SECRET`. Check it, and reject old `t`
values, before trusting the call. Failed deliveries are retried after 1, 5 and 25 seconds.

## From JavaScript

```js
import { createClient } from '@open-documents/client';
const od = createClient({ baseUrl: 'https://pdf.internal', apiKey: process.env.OD_KEY });
const pdf = await od.toPdf(docxBytes, { filename: 'report.docx' });
const stamped = await od.watermark(pdf, { text: 'DRAFT' });
const job = await od.submit('convert', bigDeck);
const later = await od.wait(job);
```

## What keeps it safe

- Every converter runs as its own process with a time limit; a stuck one is killed with
  everything it started.
- Files are identified by their bytes, not their names, and zip-based files (DOCX, XLSX, PPTX,
  ODF) are refused if their directory says they would unpack to something huge.
- LibreOffice runs with macros off and linked content never updated. A test checks that a
  picture linked from the web is never fetched.
- Uploaded HTML renders with the network off: nothing resolves, and only the files sent with it
  are served.
- Web pages and webhooks go through checks that refuse private, loopback, link-local and cloud
  metadata addresses (169.254.169.254), connect only to the address that was checked, and check
  every redirect again.
- Converters get a minimal environment: the server's own settings and keys are never passed to
  them.

Planned: running each converter in its own sandbox (nsjail) inside the image.
