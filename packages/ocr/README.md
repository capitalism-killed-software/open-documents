# @open-documents/ocr

Make scanned PDFs searchable, and read the words off page images with their positions and how
sure the reader is of each. Runs in Node and in the browser: Tesseract compiled to WebAssembly
(tesseract.js), with nothing else to install.

```sh
npm install @open-documents/ocr
```

```js
import { createOcr } from '@open-documents/ocr';

const reader = await createOcr({ languages: ['eng'] });
const searchable = await reader.ocr(scannedPdf);      // looks the same, now has text
const [page] = await reader.recognize(scannedPdf, { pages: [1] });
console.log(page.text, page.words[0]);  // { text, x, y, width, height, confidence }
await reader.close();
```

`ocr()` draws each page that has no text, reads it, and puts the text back on the page as an
invisible layer exactly over the words in the image. The page looks the same as before; the text
can be searched, selected and copied, and `extractText()` from core finds it. Pages that already
have text are left alone unless `force: true`.

English comes with the package. For other languages, install their data, for example
`npm install @tesseract.js-data/deu`, and pass `languages: ['eng', 'deu']`. Or keep the files
yourself and pass `langPath`, a folder holding `<code>.traineddata.gz`.

In a browser, serve three things from your own site and say where they are:
`tesseract.js/dist/worker.min.js` (`workerPath`), the `tesseract.js-core` folder (`corePath`)
and the language data (`langPath`). Nothing is fetched from a CDN.

Details: [docs/api.md](https://github.com/capitalism-killed-software/open-documents/blob/main/docs/api.md#ocr).
