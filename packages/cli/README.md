# @open-documents/cli

`opendocs`: convert to PDF and change PDFs from the command line.

```sh
npm install -g @open-documents/cli

opendocs merge contract.pdf appendix.pdf -o both.pdf
opendocs split both.pdf -o pages/
opendocs slice scan.pdf --columns 2
opendocs watermark both.pdf --text DRAFT
opendocs convert report.docx            # needs LibreOffice
opendocs to-docx report.pdf             # back to Word, each page's layout kept
opendocs compress big.pdf               # needs qpdf
opendocs ocr scan.pdf                   # make a scan searchable
opendocs --help
```

`convert` always makes a PDF. To go the other way, use `to-docx`, `to-pptx`, `to-markdown`,
`to-html`, `to-json` or `to-xlsx`. `to-docx` keeps each page as it looks: every line of text is
a text box where it was, which can be edited but does not flow into the next line. Folders given
with `-o` to `split` and `render --pages` are made if they don't exist.
