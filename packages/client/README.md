# @open-documents/client

Call an Open Documents server from the browser or Node, with the same function names as
`@open-documents/core`. One small dependency.

```sh
npm install @open-documents/client
```

```js
import { createClient } from '@open-documents/client';

const od = createClient({ baseUrl: 'https://pdf.internal', apiKey: process.env.OD_KEY });
const pdf = await od.toPdf(docxBytes, { filename: 'report.docx' });
const draft = await od.watermark(pdf, { text: 'DRAFT' });
const parts = await od.split(draft);

const job = await od.submit('convert', bigDeck);   // answered at once
const later = await od.wait(job);                  // collected when it is done
```

Errors are `OpenDocumentsError` with the server's `code` and the HTTP `status`.
