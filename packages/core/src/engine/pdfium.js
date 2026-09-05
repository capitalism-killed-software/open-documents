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
   * Open several documents at once, for operations that copy between them.
   *
   * @template T
   * @param {{ bytes: Uint8Array, password?: string }[]} items
   * @param {(docs: number[]) => T} use  must be synchronous
   * @returns {T}
   */
  withDocuments(items, use) {
    /** @type {(i: number, docs: number[]) => T} */
    const open = (i, docs) =>
      i === items.length
        ? use(docs)
        : this.withDocument(items[i].bytes, items[i], (doc) => open(i + 1, [...docs, doc]));
    return open(0, []);
  }

  /**
   * @template T
   * @param {(doc: number) => T} use  must be synchronous
   * @returns {T}
   */
  withNewDocument(use) {
    const doc = this.fn.FPDF_CreateNewDocument();
    if (!doc) throw new OpenDocumentsError('ENGINE_ERROR', 'Could not create a document.');
    try {
      return use(doc);
    } finally {
      this.fn.FPDF_CloseDocument(doc);
    }
  }

  /**
   * Copy pages from one document into another.
   *
   * @param {number} dest
   * @param {number} src
   * @param {number[]} indices  0-based, in the order wanted; repeats allowed
   * @param {number} at  0-based position in dest
   */
  importPages(dest, src, indices, at) {
    if (!indices.length) return;
    const ptr = this.malloc(indices.length * 4);
    try {
      indices.forEach((n, i) => this.wasm.setValue(ptr + i * 4, n, 'i32'));
      if (!this.fn.FPDF_ImportPagesByIndex(dest, src, ptr, indices.length, at)) {
        throw new OpenDocumentsError('ENGINE_ERROR', 'Pages could not be copied.');
      }
    } finally {
      this.free(ptr);
    }
  }

  /**
   * The visible area of a page in its own (unrotated) coordinates: the crop box, or the media
   * box when there is no crop box.
   *
   * @param {number} page
   * @returns {[number, number, number, number]} left, bottom, right, top
   */
  visibleBox(page) {
    const ptr = this.malloc(16);
    try {
      const at = [ptr, ptr + 4, ptr + 8, ptr + 12];
      const ok = this.fn.FPDFPage_GetCropBox(page, ...at) || this.fn.FPDFPage_GetMediaBox(page, ...at);
      if (!ok) {
        // neither box is set: PDFium falls back to US Letter, and so do we
        return [0, 0, 612, 792];
      }
      const [l, b, r, t] = at.map((p) => this.wasm.getValue(p, 'float'));
      return [Math.min(l, r), Math.min(b, t), Math.max(l, r), Math.max(b, t)];
    } finally {
      this.free(ptr);
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
   * Hand a string to PDFium as UTF-16 (FPDF_WIDESTRING) for the length of one call.
   *
   * @template T
   * @param {string} text
   * @param {(ptr: number) => T} use
   * @returns {T}
   */
  withWideString(text, use) {
    const size = (text.length + 1) * 2;
    const ptr = this.malloc(size);
    try {
      this.wasm.stringToUTF16(text, ptr, size);
      return use(ptr);
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
   * @param {number} count
   * @param {(ptr: number) => unknown} call  receives a pointer to `count` doubles
   * @returns {number[]}
   */
  readDoubles(count, call) {
    const ptr = this.malloc(count * 8);
    try {
      call(ptr);
      return Array.from({ length: count }, (_, i) => this.wasm.getValue(ptr + i * 8, 'double'));
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
