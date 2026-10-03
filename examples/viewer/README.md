# Viewer example: a small PDF editor on your own computer

`<od-viewer>` with every tool turned on, plus one library call on the page. Files never leave
the computer: the PDF engine runs in the browser.

What it can do:

- **Add to a PDF:** highlights, underlines, strike-outs, pen drawing, text boxes, notes, boxes
- **Forms:** fill them in, or draw new fields (text, check box, dropdown, list, signature)
- **Pages:** turn, delete and drag pages into a new order
- **Redact:** mark areas and take what is under them out for good
- **Save:** Download saves the PDF with every change; Download as Word turns it into a Word file
- Encrypted files ask for their password

What it cannot do yet: change the words already in a PDF, or make a Word file whose text flows
from line to line. Download as Word keeps each page as it looks, with every line of text in its
own box, which you can edit but which does not reflow.

## Run it

1. Install [Node.js](https://nodejs.org) 24 or newer, and [git](https://git-scm.com).
2. In a terminal:

   ```sh
   git clone https://github.com/capitalism-killed-software/open-documents.git
   cd open-documents
   npm ci
   npm start -w open-documents-example-viewer
   ```

3. Open http://127.0.0.1:5175/ in your browser. Click **Open**, or drop a PDF on the page.

Stop it with Ctrl+C in the terminal. Next time, only `npm start -w open-documents-example-viewer`
is needed, from the `open-documents` folder.

## In your own app

The page is `index.html` and `main.js`. The viewer part is one element:

```html
<od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm" open="true" download="true"
  annotate="true" organize="true" design="true" redact="true"></od-viewer>
```

See [packages/viewer](../../packages/viewer) for every attribute, method and event.
