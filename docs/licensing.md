# Licensing

Everything in this repository is Apache-2.0. You can use it in closed-source products, change
it, and ship it, without opening your own code. See `LICENSE` and `NOTICE`.

That promise only holds if every dependency allows the same, so the dependency tree is checked
on every change (`npm run licences`, also part of `npm run check` and CI).

## What a dependency may be licensed under

MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, BlueOak-1.0.0, CC0-1.0,
Unlicense, Python-2.0, CC-BY-4.0, and OFL-1.1 for fonts (the SIL Open Font License, which lets
fonts be bundled and embedded freely). The list lives in `tools/licence-policy.json`.

An SPDX expression passes when it can be satisfied from that list: `MIT OR GPL-3.0` passes,
`MIT AND GPL-2.0` does not. A package with no licence fails until someone checks it by hand and
writes the reason into `exceptions`.

MPL-2.0 tools (for example LibreOffice) may be used only as separate programs we start and talk
to, unmodified. They are never imported into our code.

## What we never use, whatever it claims

Many good PDF tools are AGPL or GPL. Using them would pass their terms on to everyone who embeds
this library, so they are out:

| Tool | Why |
|---|---|
| MuPDF, mupdf.js, PyMuPDF (`fitz`), pymupdf4llm, pdf2docx | AGPL-3.0 (pdf2docx through PyMuPDF) |
| Ghostscript, and anything that hands PDFs to it (ImageMagick, GraphicsMagick, pdf2pic) | AGPL-3.0 |
| iText, HexaPDF | AGPL-3.0 |
| Poppler and its wrappers (pdf2image, node-poppler) | GPL |
| Pandoc, extract-msg | GPL |
| Marker, Surya | model weights forbid competing products |
| MinerU | custom licence terms |
| Nougat | non-commercial weights |
| sharp | ships libvips, which is LGPL |

The deny list is in `tools/licence-policy.json`, with a reason next to each entry.

## OCR

`@open-documents/ocr` uses tesseract.js and tesseract.js-core (Apache-2.0), which are Tesseract
(Apache-2.0) compiled to WebAssembly. The English language data comes from
`@tesseract.js-data/eng` (the package is MIT; the data inside is Tesseract's own, Apache-2.0).
tesseract.js runs `opencollective-postinstall` when installed; it only prints a message.

## The Docling worker

`@open-documents/node` ships a small Python program, run as its own process, that uses Docling
(MIT) for document structure. Its packages are locked in `packages/node/python/uv.lock` and
checked against the same policy by `tools/check-python-licences.py` (in CI, and with
`npm run licences:python` once the worker is set up).

- PyTorch comes from its CPU-only index. The default Linux wheels pull in NVIDIA's CUDA
  libraries, which are not open source.
- Two MPL-2.0 packages are inside the worker, unmodified: certifi (Mozilla's list of
  certificate authorities) and tqdm (progress bars). MPL-2.0 applies file by file and only asks
  that changes to those files be shared; we change neither, and they run in the worker's own
  process, never in yours.
- Docling's models: the layout model is Apache-2.0, the table model CDLA-Permissive-2.0, which
  allows use and redistribution in commercial products.

## The Docker image

The image is a collection of separate programs: our server (Apache-2.0), Node.js, LibreOffice
(MPL-2.0), Chromium (BSD and others) and Debian's packages, each under its own licence. Our
code calls LibreOffice and Chromium as separate programs and links to neither.

Debian builds LibreOffice against Poppler (GPL) for LibreOffice's own PDF import, so
`libpoppler` is in the image as a dependency of LibreOffice. Our code never uses it: PDFs are
read and changed by PDFium. The smoke test refuses the packages we must never ship, such as
Ghostscript, MuPDF, ImageMagick and poppler-utils, and reports libpoppler so it stays visible.

## Adding a dependency

1. Check its licence and the licences of what it pulls in (`npm ls --all`).
2. Prefer packages with few dependencies.
3. Run `npm run licences`. If it fails, do not add an exception without a written reason.
