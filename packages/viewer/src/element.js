// <od-viewer>: a custom element, so it works in plain HTML and in any framework.
//
//   <od-viewer src="/contract.pdf" wasm-url="/pdfium.wasm"></od-viewer>
//
// Attributes: src, wasm-url (required: where pdfium.wasm is served), fonts-url, toolbar
// ("false" hides it), sidebar ("true" shows page thumbnails at start).
// Methods: load(pdf, { password, name }), save(), goToPage(n), zoomIn(), zoomOut(),
// fitWidth(), search(text).
// Events: od-load { pageCount, name }, od-page { page, pageCount }, od-error { code, message }.
import { h, render } from 'preact';
import { App } from './app.js';
import { STYLES } from './styles.js';
import { ZoomMode } from '@embedpdf/plugin-zoom';

/** @typedef {Uint8Array | ArrayBuffer | Blob | string | URL} PdfSource */

export class OdViewer extends HTMLElement {
  static observedAttributes = ['src', 'wasm-url', 'fonts-url', 'toolbar', 'sidebar'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {{ current: { buffer: ArrayBuffer, name: string, password?: string, done: (v: any) => void, fail: (e: any) => void } | null }} */
    this.pending = { current: null };
    /** @type {import('./app.js').Controller & { open?: (job: any) => void }} */
    this.controller = { emit: (event, detail) => this.dispatchEvent(new CustomEvent(event, { detail, bubbles: true, composed: true })) };
    this.controller.open = (job) => this.#open(job);
    /** @type {{ page: number, pageCount: number }} */
    this.state = { page: 0, pageCount: 0 };
    this.addEventListener('od-page', (/** @type {any} */ e) => Object.assign(this.state, e.detail));
  }

  connectedCallback() {
    this.#render();
    const src = this.getAttribute('src');
    if (src) this.load(src).catch(() => {});
  }

  disconnectedCallback() {
    render(null, /** @type {ShadowRoot} */ (this.shadowRoot));
    this.controller.registry = undefined;
  }

  /**
   * @param {string} name
   * @param {string | null} before
   * @param {string | null} after
   */
  attributeChangedCallback(name, before, after) {
    if (!this.isConnected || before === after) return;
    if (name === 'src' && after) this.load(after).catch(() => {});
    else if (name !== 'src') this.#render();
  }

  /** Page number in view, from 1. */
  get page() {
    return this.state.page;
  }

  get pageCount() {
    return this.state.pageCount;
  }

  /**
   * Show a PDF: bytes, an ArrayBuffer, a Blob or File, or a URL to fetch.
   *
   * @param {PdfSource} source
   * @param {{ password?: string, name?: string }} [options]
   * @returns {Promise<{ pageCount: number }>}
   */
  async load(source, options = {}) {
    const { buffer, name } = await toBuffer(source, options.name);
    return new Promise((done, fail) => {
      const job = { buffer, name, password: options.password, done, fail };
      this.pending.current = job;
      if (this.controller.registry) this.#open(job);
    });
  }

  /**
   * The document as it is now, with any changes, as PDF bytes.
   *
   * @returns {Promise<Uint8Array>}
   */
  async save() {
    const exporter = this.#capability('export');
    const id = this.controller.documentId;
    if (!exporter || !id) throw new Error('No document is open.');
    const buffer = await taskToPromise(exporter.forDocument(id).saveAsCopy());
    return new Uint8Array(/** @type {ArrayBuffer} */ (buffer));
  }

  /** @param {number} page  from 1 */
  goToPage(page) {
    this.#scroll()?.scrollToPage({ pageNumber: page, behavior: 'instant' });
  }

  zoomIn() {
    this.#zoom()?.zoomIn();
  }

  zoomOut() {
    this.#zoom()?.zoomOut();
  }

  fitWidth() {
    this.#zoom()?.requestZoom(ZoomMode.FitWidth);
  }

  /**
   * Highlight every match and go to the first.
   *
   * @param {string} text
   * @returns {Promise<number>} how many matches
   */
  async search(text) {
    const search = this.#capability('search');
    const id = this.controller.documentId;
    if (!search || !id) return 0;
    const result = await taskToPromise(search.forDocument(id).searchAllPages(text));
    return /** @type {any} */ (result)?.total ?? /** @type {any} */ (result)?.results?.length ?? 0;
  }

  #render() {
    const wasm = this.getAttribute('wasm-url');
    if (!wasm) {
      render(h('p', { class: 'message error' }, 'Set wasm-url to where pdfium.wasm is served.'), /** @type {ShadowRoot} */ (this.shadowRoot));
      return;
    }
    const fonts = this.getAttribute('fonts-url');
    render(
      h('div', { style: 'display:contents' }, [
        h('style', null, STYLES),
        h(App, {
          wasmUrl: new URL(wasm, document.baseURI).href,
          fontsUrl: fonts ? new URL(fonts, document.baseURI).href : null,
          toolbar: this.getAttribute('toolbar') !== 'false',
          sidebar: this.getAttribute('sidebar') === 'true',
          controller: this.controller,
          pending: this.pending,
        }),
      ]),
      /** @type {ShadowRoot} */ (this.shadowRoot),
    );
  }

  /** @param {{ buffer: ArrayBuffer, name: string, password?: string, done: (v: any) => void, fail: (e: any) => void }} job */
  async #open(job) {
    if (this.pending.current !== job) return; // a newer load() won
    const manager = this.#capability('document-manager');
    if (!manager) return;
    const previous = this.controller.documentId;
    try {
      const opened = await taskToPromise(manager.openDocumentBuffer({ buffer: job.buffer, name: job.name, password: job.password, autoActivate: true }));
      const doc = await taskToPromise(/** @type {any} */ (opened).task);
      if (this.pending.current !== job) return;
      this.pending.current = null;
      this.controller.documentId = /** @type {any} */ (opened).documentId;
      if (previous && previous !== this.controller.documentId) manager.closeDocument(previous);
      const pageCount = /** @type {any} */ (doc).pageCount ?? 0;
      this.state.pageCount = pageCount;
      await this.#settled();
      this.controller.emit('od-load', { pageCount, name: job.name });
      job.done({ pageCount });
    } catch (err) {
      // EmbedPDF rejects with { type, reason: { code, message } }; code 4 is PDFium's password error
      const reason = /** @type {any} */ (err)?.reason ?? err;
      const password = reason?.code === 4 || /password/i.test(String(reason?.message ?? ''));
      const detail = {
        code: password ? 'PASSWORD_REQUIRED' : 'DAMAGED_FILE',
        message: password ? 'This file is encrypted: the password is missing or wrong.' : String(reason?.message ?? 'This file could not be opened.'),
      };
      this.controller.emit('od-error', detail);
      job.fail(Object.assign(new Error(detail.message), { code: detail.code }));
    }
  }

  /**
   * Wait for a newly opened document to be laid out and zoomed to its first fit, which scrolls
   * the view back to the top. Until then a goToPage() would be undone.
   */
  async #settled() {
    const zoom = this.#zoom();
    await new Promise((resolve) => {
      const timer = setTimeout(done, 600);
      const off = zoom?.onZoomChange?.(() => done());
      function done() {
        clearTimeout(timer);
        if (typeof off === 'function') off();
        resolve(undefined);
      }
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))));
  }

  /** @param {string} id */
  #capability(id) {
    return this.controller.registry?.getPlugin(id)?.provides() ?? null;
  }

  #scroll() {
    const id = this.controller.documentId;
    return id ? this.#capability('scroll')?.forDocument(id) : null;
  }

  #zoom() {
    const id = this.controller.documentId;
    return id ? this.#capability('zoom')?.forDocument(id) : null;
  }
}

/**
 * @param {PdfSource} source
 * @param {string} [name]
 * @returns {Promise<{ buffer: ArrayBuffer, name: string }>}
 */
async function toBuffer(source, name) {
  if (source instanceof Uint8Array) return { buffer: source.slice().buffer, name: name ?? 'document.pdf' };
  if (source instanceof ArrayBuffer) return { buffer: source.slice(0), name: name ?? 'document.pdf' };
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return { buffer: await source.arrayBuffer(), name: name ?? (/** @type {any} */ (source).name || 'document.pdf') };
  }
  const url = new URL(String(source), document.baseURI);
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`Could not fetch ${url.pathname}: HTTP ${res.status}`), { code: 'INVALID_INPUT' });
  return { buffer: await res.arrayBuffer(), name: name ?? decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf') };
}

/**
 * EmbedPDF's tasks, as promises.
 *
 * @param {any} task
 */
function taskToPromise(task) {
  return new Promise((resolve, reject) => task.wait(resolve, reject));
}
