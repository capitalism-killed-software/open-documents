# @open-documents/cli

`opendocs`: convert to PDF and change PDFs from the command line.

```sh
npm install -g @open-documents/cli

opendocs merge contract.pdf appendix.pdf -o both.pdf
opendocs split both.pdf -o pages/
opendocs slice scan.pdf --columns 2
opendocs watermark both.pdf --text DRAFT
opendocs convert report.docx            # needs LibreOffice
opendocs compress big.pdf               # needs qpdf
opendocs ocr scan.pdf                   # make a scan searchable
opendocs --help
```
