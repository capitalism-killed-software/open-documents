// PDFium compiled to WebAssembly. One instance per process (or per worker), loaded on first use.
// PDFium is single-threaded and every call into it is synchronous, so callers must not await
// between opening a document and closing it. withDocument() makes that the only way to use it.

import { init } from '@embedpdf/pdfium';
import { loadWasm } from '#platform';
import { OpenDocumentsError } from '../errors.js';

/** @typedef {import('@embedpdf/pdfium').WrappedPdfiumModule} PdfiumModule */

/**
 * @typedef {object} EngineSettings
 * @property {string | URL} [wasmUrl]  where pdfium.wasm lives (required in browsers)
 * @property {Uint8Array} [wasmBinary] the WASM bytes, if the app already has them
 */

/** @type {EngineSettings} */
let settings = {};
/** @type {Promise<Engine> | null} */
let loading = null;

/**
 * Set engine options. Call before the first operation; later calls are refused because the
 * engine is already loaded.
 *
 * @param {EngineSettings} options
 */
export function configure(options) {
  if (loading) {
    throw new OpenDocumentsError('INVALID_OPTION', 'configure() must be called before the first operation.');
  }
  settings = { ...settings, ...options };
}

/** @returns {Promise<Engine>} */
export function engine() {
  loading ??= (async () => {
    const wasmBinary = settings.wasmBinary ?? (await loadWasm(settings));
    const module = await init({ wasmBinary });
    module.PDFiumExt_Init();
    return new Engine(module);
  })();
  return loading;
}

// FPDF_GetLastError() values
const LOAD_ERRORS = {
  2: ['DAMAGED_FILE', 'The file could not be read.'],
  3: ['DAMAGED_FILE', 'The file is not a valid PDF or is damaged.'],
  4: ['PASSWORD_REQUIRED', 'The file is encrypted: the password is missing or wrong.'],
  5: ['UNSUPPORTED_SECURITY', 'The file uses an encryption scheme that is not supported.'],
  6: ['PAGE_NOT_FOUND', 'The page could not be found.'],
};

export class Engine {
  /** @param {PdfiumModule} module */
  constructor(module) {
    this.fn = module;
    this.wasm = module.pdfium;
  }

  /** @param {number} size */
  malloc(size) {
    const ptr = this.wasm.wasmExports.malloc(size);
    if (!ptr) throw new OpenDocumentsError('ENGINE_ERROR', `Out of engine memory allocating ${size} bytes.`);
    return ptr;
  }

  /** @param {number} ptr */
  free(ptr) {
    this.wasm.wasmExports.free(ptr);
  }

  /**
   * Open a document, hand its handle to `use`, and always close it again.
   *
   * @template T
   * @param {Uint8Array} bytes
   * @param {{ password?: string }} options
   * @param {(doc: number) => T} use  must be synchronous
   * @returns {T}
   */
  withDocument(bytes, options, use) {
    const data = this.malloc(bytes.length);
    let doc = 0;
    try {
      this.wasm.HEAPU8.set(bytes, data);
      doc = this.fn.FPDF_LoadMemDocument(data, bytes.length, options.password ?? '');
      if (!doc) {
        const [code, message] = LOAD_ERRORS[this.fn.FPDF_GetLastError()] ?? ['DAMAGED_FILE', 'The file could not be opened.'];
        throw new OpenDocumentsError(code, message);
      }
      return use(doc);
    } finally {
      if (doc) this.fn.FPDF_CloseDocument(doc);
      this.free(data);
    }
  }

  /**
   * @template T
   * @param {number} doc
   * @param {number} index  0-based
   * @param {(page: number) => T} use
   * @returns {T}
   */
  withPage(doc, index, use) {
    const page = this.fn.FPDF_LoadPage(doc, index);
    if (!page) throw new OpenDocumentsError('PAGE_NOT_FOUND', `Page ${index + 1} could not be loaded.`);
    try {
      return use(page);
    } finally {
      this.fn.FPDF_ClosePage(page);
    }
  }

  /**
   * @template T
   * @param {number} page
   * @param {(textPage: number) => T} use
   * @returns {T}
   */
  withTextPage(page, use) {
    const textPage = this.fn.FPDFText_LoadPage(page);
    if (!textPage) throw new OpenDocumentsError('ENGINE_ERROR', 'Could not read the text on this page.');
    try {
      return use(textPage);
    } finally {
      this.fn.FPDFText_ClosePage(textPage);
    }
  }

  /**
   * Call a PDFium "get string" function twice: once for the length in bytes, once to fill a
   * buffer. `call(ptr, length)` must return the length in bytes, including the terminator.
   *
   * @param {(ptr: number, length: number) => number} call
   * @returns {string}
   */
  readUtf16(call) {
    const length = call(0, 0);
    if (length <= 2) return '';
    const ptr = this.malloc(length);
    try {
      call(ptr, length);
      return this.wasm.UTF16ToString(ptr);
    } finally {
      this.free(ptr);
    }
  }

  /**
   * @param {number} count
   * @param {(ptr: number) => unknown} call  receives a pointer to `count` floats
   * @returns {number[]}
   */
  readFloats(count, call) {
    const ptr = this.malloc(count * 4);
    try {
      call(ptr);
      return Array.from({ length: count }, (_, i) => this.wasm.getValue(ptr + i * 4, 'float'));
    } finally {
      this.free(ptr);
    }
  }

  /**
   * Write the whole document out again, without incremental updates.
   *
   * @param {number} doc
   * @returns {Uint8Array}
   */
  save(doc) {
    const writer = this.fn.PDFiumExt_OpenFileWriter();
    try {
      if (!this.fn.PDFiumExt_SaveAsCopy(doc, writer)) {
        throw new OpenDocumentsError('ENGINE_ERROR', 'The document could not be saved.');
      }
      const size = this.fn.PDFiumExt_GetFileWriterSize(writer);
      const ptr = this.malloc(size);
      try {
        this.fn.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return this.wasm.HEAPU8.slice(ptr, ptr + size);
      } finally {
        this.free(ptr);
      }
    } finally {
      this.fn.PDFiumExt_CloseFileWriter(writer);
    }
  }
}
