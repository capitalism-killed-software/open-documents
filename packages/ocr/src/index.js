// Optical character recognition with Tesseract (tesseract.js, WebAssembly), in Node and in the
// browser. Pages are drawn with PDFium, read by a small pool of Tesseract workers, and the text
// Tesseract finds goes back onto each page as an invisible layer, so the PDF looks the same and
// can be searched, selected and copied.
import Tesseract from 'tesseract.js';
import { inspect, extractText, renderPage, merge, overlay, pageRanges, OpenDocumentsError } from '@open-documents/core';
import { languageData, workerPaths, imageInput } from '#platform';

const LSTM_ONLY = 1;
// A page with fewer characters than this counts as having no text: scanners and phone apps
// often stamp a line or two of real text onto an otherwise scanned page.
const ENOUGH_TEXT = 20;

/**
 * @typedef {object} OcrEngineOptions
 * @property {string[]} [languages]  Tesseract codes such as "eng", "deu", "fra", "spa"; default
 *   ["eng"]. Each needs its data: the @tesseract.js-data/<code> package or a file in langPath.
 * @property {number} [workers]   pages read at the same time, 1 to 16; default 2
 * @property {string} [langPath]  a folder (Node) or URL (browser) holding <code>.traineddata.gz
 * @property {string} [workerPath]  browser only: URL of tesseract.js/dist/worker.min.js
 * @property {string} [corePath]    browser only: URL of the tesseract.js-core folder
 */

/**
 * @typedef {object} PageOptions
 * @property {import('@open-documents/core').PageSelection} [pages]  default all
 * @property {number} [dpi]  how finely each page is drawn for reading, 100 to 600; default 300
 * @property {string} [password]
 */

/**
 * @typedef {object} PageReport
 * @property {number} page
 * @property {boolean} skipped  true when the page already had text
 * @property {number} [confidence]  Tesseract's mean word confidence, 0 to 100
 */

/**
 * @typedef {PageOptions & {
 *   force?: boolean,
 *   onPage?: (report: PageReport) => void,
 * }} OcrOptions
 *   force reads pages that already have text too; their text is then there twice.
 *   onPage hears about each page as it is done or skipped.
 */

/**
 * @typedef {object} RecognizedWord
 * @property {string} text
 * @property {number} x  points from the left edge, as shown
 * @property {number} y  points from the top edge, as shown
 * @property {number} width
 * @property {number} height
 * @property {number} confidence  0 to 100
 */

/**
 * @typedef {object} RecognizedPage
 * @property {number} page
 * @property {number} width   points, as shown
 * @property {number} height  points, as shown
 * @property {string} text
 * @property {number} confidence  0 to 100
 * @property {RecognizedWord[]} words
 */

/**
 * @typedef {object} OcrEngine
 * @property {(input: import('@open-documents/core').DocumentInput, options?: OcrOptions) => Promise<Uint8Array>} ocr
 * @property {(input: import('@open-documents/core').DocumentInput, options?: PageOptions) => Promise<RecognizedPage[]>} recognize
 * @property {() => Promise<void>} close
 */

/**
 * Start Tesseract once and use it for many documents. Starting takes about a second per worker;
 * close() when done.
 *
 * @param {OcrEngineOptions} [options]
 * @returns {Promise<OcrEngine>}
 */
export async function createOcr(options = {}) {
  const languages = checkLanguages(options.languages ?? ['eng']);
  const count = whole(options.workers ?? 2, 'workers', 1, 16);
  const paths = workerPaths(options);
  const data = languageData(languages, options);
  const settings = { ...data.options, ...paths, cacheMethod: 'none', gzip: true };
  const started = await Promise.allSettled(Array.from({ length: count }, () => Tesseract.createWorker(languages, LSTM_ONLY, settings)));
  const workers = started.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failure = started.find((s) => s.status === 'rejected');
  if (failure) {
    await Promise.all(workers.map((w) => w.terminate()));
    data.close();
    throw new OpenDocumentsError('ENGINE_ERROR', `Tesseract could not start: ${reason(/** @type {PromiseRejectedResult} */ (failure).reason)}`);
  }
  const use = pool(workers);
  let closed = false;
  /** @type {<T>(job: (worker: Tesseract.Worker) => Promise<T>) => Promise<T>} */
  const run = (job) => {
    if (closed) throw new OpenDocumentsError('ENGINE_ERROR', 'This OCR engine has been closed.');
    return use(job);
  };
  return {
    ocr: (input, opts = {}) => searchable(run, input, opts),
    recognize: (input, opts = {}) => recognizePages(run, input, opts),
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(workers.map((w) => w.terminate()));
      data.close();
    },
  };
}

/**
 * Make a scanned PDF searchable: read the pages that have no text and put what was read back
 * onto them as invisible text. Pages look the same as before.
 *
 * @param {import('@open-documents/core').DocumentInput} input
 * @param {OcrOptions & OcrEngineOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function ocr(input, options = {}) {
  const engine = await createOcr(options);
  try {
    return await engine.ocr(input, options);
  } finally {
    await engine.close();
  }
}

/**
 * Read the words on pages, with where each one is and how sure Tesseract is.
 *
 * @param {import('@open-documents/core').DocumentInput} input
 * @param {PageOptions & OcrEngineOptions} [options]
 * @returns {Promise<RecognizedPage[]>}
 */
export async function recognize(input, options = {}) {
  const engine = await createOcr(options);
  try {
    return await engine.recognize(input, options);
  } finally {
    await engine.close();
  }
}

/**
 * @param {<T>(job: (worker: Tesseract.Worker) => Promise<T>) => Promise<T>} run
 * @param {import('@open-documents/core').DocumentInput} input
 * @param {OcrOptions} options
 */
async function searchable(run, input, options) {
  const bytes = await asBytes(input);
  const dpi = checkDpi(options.dpi);
  const pages = await extractText(bytes, { pages: options.pages, password: options.password });
  const todo = [];
  for (const { page, text } of pages) {
    if (!options.force && text.replace(/\s+/g, '').length >= ENOUGH_TEXT) options.onPage?.({ page, skipped: true });
    else todo.push(page);
  }
  const done = await Promise.all(todo.map((page) => run(async (worker) => {
    const image = await renderPage(bytes, { page, dpi, annotations: false, password: options.password });
    const result = await read(worker, image.data, dpi, { pdf: true, text: false });
    options.onPage?.({ page, skipped: false, confidence: result.confidence });
    return /** @type {Uint8Array} */ (new Uint8Array(/** @type {number[]} */ (result.pdf)));
  })));
  if (!done.length) return bytes.slice();
  const layer = done.length === 1 ? done[0] : await merge(done);
  return overlay(bytes, layer, { pages: todo, fit: 'stretch', password: options.password });
}

/**
 * @param {<T>(job: (worker: Tesseract.Worker) => Promise<T>) => Promise<T>} run
 * @param {import('@open-documents/core').DocumentInput} input
 * @param {PageOptions} options
 * @returns {Promise<RecognizedPage[]>}
 */
async function recognizePages(run, input, options) {
  const bytes = await asBytes(input);
  const dpi = checkDpi(options.dpi);
  const { pageCount } = await inspect(bytes, { password: options.password });
  const pages = selectPages(options.pages, pageCount);
  const points = 72 / dpi;
  return Promise.all(pages.map((page) => run(async (worker) => {
    const image = await renderPage(bytes, { page, dpi, annotations: false, password: options.password });
    const result = await read(worker, image.data, dpi, { text: true, blocks: true });
    /** @type {RecognizedWord[]} */
    const words = [];
    for (const block of result.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const w of line.words) {
            if (!w.text.trim()) continue;
            words.push({
              text: w.text,
              x: round(w.bbox.x0 * points),
              y: round(w.bbox.y0 * points),
              width: round((w.bbox.x1 - w.bbox.x0) * points),
              height: round((w.bbox.y1 - w.bbox.y0) * points),
              confidence: round(w.confidence),
            });
          }
        }
      }
    }
    return {
      page,
      width: round(image.width * points),
      height: round(image.height * points),
      text: result.text,
      confidence: round(result.confidence),
      words,
    };
  })));
}

/**
 * @param {Tesseract.Worker} worker
 * @param {Uint8Array} png
 * @param {number} dpi
 * @param {Partial<Tesseract.OutputFormats>} output
 */
async function read(worker, png, dpi, output) {
  try {
    // tells Tesseract how big the text really is; the PDF it writes is sized from it too
    await worker.setParameters({ user_defined_dpi: String(dpi) });
    const { data } = await worker.recognize(imageInput(png), { pdfTextOnly: true }, { text: false, ...output });
    return data;
  } catch (e) {
    throw new OpenDocumentsError('CONVERSION_FAILED', `Tesseract could not read the page: ${reason(e)}`);
  }
}

/**
 * Lend each job a free worker, queueing jobs while all are busy.
 *
 * @template W
 * @param {W[]} workers
 * @returns {<T>(job: (worker: W) => Promise<T>) => Promise<T>}
 */
function pool(workers) {
  const idle = [...workers];
  /** @type {((worker: W) => void)[]} */
  const waiting = [];
  return async (job) => {
    const worker = idle.pop() ?? (await new Promise((resolve) => waiting.push(resolve)));
    try {
      return await job(worker);
    } finally {
      const next = waiting.shift();
      if (next) next(worker);
      else idle.push(worker);
    }
  };
}

/**
 * @param {import('@open-documents/core').PageSelection | undefined} pages
 * @param {number} pageCount
 * @returns {number[]}
 */
function selectPages(pages, pageCount) {
  if (pages === undefined) return Array.from({ length: pageCount }, (_, i) => i + 1);
  if (typeof pages === 'string') return pageRanges(pages, pageCount);
  if (!Array.isArray(pages)) throw new OpenDocumentsError('INVALID_OPTION', 'pages must be an array of page numbers or a page list like "1-3,5".');
  for (const n of pages) {
    if (!Number.isInteger(n)) throw new OpenDocumentsError('INVALID_OPTION', 'pages must be whole page numbers.');
    if (n < 1 || n > pageCount) throw new OpenDocumentsError('PAGE_NOT_FOUND', `Page ${n} does not exist: the document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
  }
  return pages;
}

/** @param {unknown} languages */
function checkLanguages(languages) {
  if (!Array.isArray(languages) || !languages.length || !languages.every((c) => typeof c === 'string' && /^[a-z][a-z0-9_]{1,30}$/i.test(c))) {
    throw new OpenDocumentsError('INVALID_OPTION', 'languages must be a list of Tesseract language codes, like ["eng", "deu"].');
  }
  return [...new Set(/** @type {string[]} */ (languages))];
}

/** @param {number | undefined} dpi */
function checkDpi(dpi) {
  return whole(dpi ?? 300, 'dpi', 100, 600);
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {number} min
 * @param {number} max
 */
function whole(value, name, min, max) {
  if (!Number.isInteger(value) || /** @type {number} */ (value) < min || /** @type {number} */ (value) > max) {
    throw new OpenDocumentsError('INVALID_OPTION', `${name} must be a whole number from ${min} to ${max}.`);
  }
  return /** @type {number} */ (value);
}

/** @param {import('@open-documents/core').DocumentInput} input */
async function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  throw new OpenDocumentsError('INVALID_INPUT', 'Expected a Uint8Array, ArrayBuffer or Blob.');
}

/** @param {number} n */
const round = (n) => Math.round(n * 100) / 100;

/** @param {unknown} e */
const reason = (e) => (e instanceof Error ? e.message : String(e));
