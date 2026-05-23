# Changelog

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
