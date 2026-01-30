# Licensing

Everything in this repository is Apache-2.0. You can use it in closed-source products, change
it, and ship it, without opening your own code. See `LICENSE` and `NOTICE`.

That promise only holds if every dependency allows the same, so the dependency tree is checked
on every change (`npm run licences`, also part of `npm run check` and CI).

## What a dependency may be licensed under

MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, BlueOak-1.0.0, CC0-1.0,
Unlicense, Python-2.0, CC-BY-4.0. The list lives in `tools/licence-policy.json`.

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

## Adding a dependency

1. Check its licence and the licences of what it pulls in (`npm ls --all`).
2. Prefer packages with few dependencies.
3. Run `npm run licences`. If it fails, do not add an exception without a written reason.
