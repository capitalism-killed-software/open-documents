# @open-documents/node

Turn documents into PDFs in Node: Word, Excel, PowerPoint, OpenDocument, RTF, CSV and text
through LibreOffice; HTML, Markdown, email (`.eml`, Outlook `.msg`) and web pages through
Chromium; images; plus lossless compression, fast web view and repair through qpdf.

```sh
npm install @open-documents/node
npx playwright-core install chromium   # for HTML, Markdown, email and web pages
# and LibreOffice and qpdf from your package manager
```

```js
import { createConverter } from '@open-documents/node';

const converter = createConverter();
const pdf = await converter.toPdf(docxBytes, { filename: 'report.docx' });
const page = await converter.urlToPdf('https://example.com', { format: 'a4' });
const smaller = await converter.compress(pdf);
await converter.close();
```

Untrusted files are handled with care: types are read from the bytes, zip bombs are refused
before unpacking, every program runs with a time limit and a minimal environment, uploaded HTML
cannot reach the network, and web pages cannot reach private addresses.

Details: [docs/api.md](https://github.com/capitalism-killed-software/open-documents/blob/main/docs/api.md).
