// A client for the Open Documents server. It runs anywhere `fetch` does, has one small
// dependency, and mirrors @open-documents/core: client.rotate(pdf, { angle: 90 }) does over
// HTTP what rotate(pdf, { angle: 90 }) does locally.
import { unzipSync } from 'fflate';

/** The same shape as the server's errors: a stable `code`, a message, and the HTTP status. */
export class OpenDocumentsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'OpenDocumentsError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @typedef {Uint8Array | ArrayBuffer | Blob} Input
 * @typedef {{ id: string, status: 'queued' | 'running' | 'done' | 'failed', error: { code: string, message: string } | null, links: { self: string, result: string } }} Job
 */

/**
 * @param {object} options
 * @param {string} options.baseUrl  e.g. "https://pdf.example.com"
 * @param {string} [options.apiKey]
 * @param {typeof fetch} [options.fetch]
 */
export function createClient(options) {
  if (!options?.baseUrl) throw new TypeError('createClient needs a baseUrl.');
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  /** @type {Record<string, string>} */
  const auth = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};

  /**
   * @param {string} path
   * @param {RequestInit} init
   */
  const call = async (path, init) => {
    const res = await doFetch(`${base}${path}`, { ...init, headers: { ...auth, ...(/** @type {Record<string, string>} */ (init.headers ?? {})) } });
    if (!res.ok && res.status !== 202) {
      const body = await res.json().catch(() => null);
      throw new OpenDocumentsError(body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `The server answered ${res.status}.`, res.status);
    }
    return res;
  };

  /**
   * @param {Response} res
   * @returns {Promise<any>}
   */
  const read = async (res) => {
    const type = res.headers.get('content-type') ?? '';
    if (type.startsWith('application/json')) return res.json();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (type.startsWith('application/zip')) return Object.values(unzipSync(bytes));
    return bytes;
  };

  /**
   * @param {Input[]} files
   * @param {Record<string, unknown>} opts
   * @param {string[]} [names]
   */
  const formOf = (files, opts, names = []) => {
    const form = new FormData();
    files.forEach((f, i) => form.append('file', f instanceof Blob ? f : new Blob([/** @type {BlobPart} */ (f)]), names[i] ?? `file-${i + 1}`));
    form.append('options', JSON.stringify(opts));
    return form;
  };

  /**
   * Run any operation by its API name, for operations without a helper below.
   *
   * @param {string} operation  e.g. "rotate", "page-numbers"
   * @param {Input | Input[]} input
   * @param {Record<string, unknown>} [opts]
   */
  const run = async (operation, input, opts = {}) => {
    const files = Array.isArray(input) ? input : [input];
    return read(await call(`/v1/pdf/${operation}`, { method: 'POST', body: formOf(files, opts) }));
  };

  /** @param {string} operation */
  const one = (operation) => (/** @type {Input} */ input, /** @type {Record<string, unknown>} */ opts = {}) => run(operation, input, opts);

  /** @param {Job} job */
  const wait = async (job, { interval = 500, timeout = 120_000 } = {}) => {
    const until = Date.now() + timeout;
    let current = job;
    while (current.status === 'queued' || current.status === 'running') {
      if (Date.now() > until) throw new OpenDocumentsError('TIMEOUT', `Job ${job.id} did not finish in time.`, 0);
      await new Promise((resolve) => setTimeout(resolve, interval));
      current = await (await call(current.links.self, { method: 'GET' })).json();
    }
    return read(await call(current.links.result, { method: 'GET' }));
  };

  return {
    run,
    // read
    inspect: one('inspect'),
    extractText: one('text'),
    extractWords: one('words'),
    getBookmarks: one('bookmarks'),
    /** @returns {Promise<Uint8Array | Uint8Array[]>} one PNG, or one per page */
    renderPages: one('render'),
    thumbnails: one('thumbnails'),
    // pages
    /** @param {Input[]} inputs */
    merge: (inputs, opts = {}) => run('merge', inputs, opts),
    /** @returns {Promise<Uint8Array[]>} */
    split: one('split'),
    /** @param {Input} input @param {number[] | string} pages */
    extractPages: (input, pages, opts = {}) => run('extract-pages', input, { ...opts, pages }),
    /** @param {Input} input @param {number[] | string} pages */
    removePages: (input, pages, opts = {}) => run('remove-pages', input, { ...opts, pages }),
    /** @param {Input} input @param {number[] | string} order */
    reorder: (input, order, opts = {}) => run('reorder', input, { ...opts, order }),
    rotate: one('rotate'),
    slicePages: one('slice'),
    crop: one('crop'),
    nUp: one('n-up'),
    insertBlankPages: one('insert-blank-pages'),
    // edit
    addText: one('add-text'),
    watermark: one('watermark'),
    pageNumbers: one('page-numbers'),
    headerFooter: one('header-footer'),
    bates: one('bates'),
    setMetadata: one('metadata'),
    /** @param {Input} input @param {object[]} bookmarks */
    setBookmarks: (input, bookmarks, opts = {}) => run('set-bookmarks', input, { ...opts, bookmarks }),
    /** @param {Input} input @param {Input} layer */
    overlay: (input, layer, opts = {}) => run('overlay', [input, layer], opts),
    encrypt: one('encrypt'),
    decrypt: one('decrypt'),
    // structure (needs qpdf on the server)
    compress: one('compress'),
    linearize: one('linearize'),
    repair: one('repair'),
    // OCR (the server reads the languages it was started with)
    ocr: one('ocr'),
    recognize: one('recognize'),
    /** @param {Input[]} images */
    imagesToPdf: (images, opts = {}) => run('images-to-pdf', images, opts),
    // convert
    /** @param {Input} input @param {Record<string, unknown> & { filename?: string }} [opts] */
    toPdf: async (input, opts = {}) => {
      const { filename, ...rest } = opts;
      return read(await call('/v1/convert', { method: 'POST', body: formOf([input], rest, [filename ?? 'document']) }));
    },
    /** @param {string} html */
    htmlToPdf: async (html, opts = {}) => read(await call('/v1/convert/html', json({ html, options: opts }))),
    /** @param {string} markdown */
    markdownToPdf: async (markdown, opts = {}) => read(await call('/v1/convert/markdown', json({ markdown, options: opts }))),
    /** @param {string} url */
    urlToPdf: async (url, opts = {}) => read(await call('/v1/convert/url', json({ url, options: opts }))),
    // jobs: submit now, collect later
    /**
     * @param {string} operation  an operation name, or "convert"
     * @param {Input | Input[]} input
     * @param {Record<string, unknown>} [opts]  may include `webhook`
     * @returns {Promise<Job>}
     */
    submit: async (operation, input, opts = {}) => {
      const files = Array.isArray(input) ? input : [input];
      const path = operation === 'convert' ? '/v1/convert' : `/v1/pdf/${operation}`;
      return (await call(path, { method: 'POST', headers: { prefer: 'respond-async' }, body: formOf(files, opts) })).json();
    },
    wait,
  };
}

/** @param {object} body */
function json(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
