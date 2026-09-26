# Changelog

## Unreleased

- **@open-documents/ocr**, new: make scanned PDFs searchable and read words with their
  positions and confidence, with Tesseract in WebAssembly, in Node and the browser.
- **Out of PDF:** Word and PowerPoint keeping each page's layout, with editable text (core);
  Markdown, HTML, JSON and tables to Excel with Docling in a Python worker (node).
- **Forms:** read every field, fill them by name, add new ones (text, check box, dropdown, list,
  signature), flatten. Encryption is kept.
- **Compare:** the words that changed between two versions and where they are, how much each
  page changed, and a side-by-side report with the changes marked.
- **Redaction:** areas, words and patterns taken out of the file for good (text, image pixels,
  drawings, form fields, metadata, bookmarks), checked afterwards, with a picture of the page as
  the fallback.
- **Signatures:** sign (PAdES, with pyHanko) and check every signature in a file.
- **PDF/A:** from office files, web pages and images, a fix-up for existing PDFs, and a check
  for the common problems.
- **Smaller files:** scans and photos scaled down and stored as JPEG or PNG.
- **Overlay:** another PDF's pages over or under the pages: letterheads, backgrounds.
- **Viewer:** a form designer, redaction, and form fields that no longer lose keystrokes when
  typed into fast on a busy machine.
- The server, client and `opendocs` command have all of the above. A larger Docker image
  (`docker/Dockerfile.full`) adds Docling and pyHanko.

## 0.1.1

- Releases are published from GitHub Actions with npm trusted publishing, so no npm token
  exists to leak. Each package carries a provenance statement linking it to its commit.
- The `opendocs` and `opendocs-server` commands are declared the way npm expects, which ends a
  warning at publish time. Nothing changes for anyone installing them.

## 0.1.0

The first release. Everything is early: the APIs may change before 1.0.

- **@open-documents/core**, for browsers and Node: inspect; render pages, thumbnails; text and
  words with positions; merge, split, extract, remove, reorder, rotate, slice into pieces, crop,
  N-up, blank pages; text, watermarks, page numbers, headers and footers, Bates numbers;
  metadata; bookmarks; AES-256 encryption with permissions, and decryption; JPEG and PNG to PDF.
- **@open-documents/node**: Word, Excel, PowerPoint, OpenDocument, RTF, CSV, text, TIFF and other
  images to PDF through LibreOffice; HTML, Markdown, email (`.eml`, `.msg`) and web pages through
  Chromium; lossless compression, fast web view and repair through qpdf. File types read from
  the bytes, zip bombs refused, private addresses unreachable.
- **@open-documents/server**: the REST API, with API keys, size limits, async jobs and signed
  webhooks. A Docker image in `docker/`.
- **@open-documents/client**: the API from JavaScript, with the same names as core.
- **@open-documents/viewer**: `<od-viewer>`, a viewer for any web page: thumbnails, zoom, search,
  text selection, annotations with undo, form filling, and turning, deleting and reordering pages.
- **@open-documents/cli**: `opendocs`, all of the above from the command line.
