// PDF/A, the archive form of PDF: a quick check for the problems that most often stop a file
// from being PDF/A, and a best-effort conversion that fixes what can be fixed without changing
// how pages look. Neither replaces a full validator such as veraPDF.
import { engine } from './engine/pdfium.js';
import { toPdfBytes } from './input.js';
import { fail } from './errors.js';

const PAGEOBJ_TEXT = 1;
const PAGEOBJ_FORM = 5;
const INVISIBLE = 3;

/**
 * @typedef {object} PdfAProblem
 * @property {'ENCRYPTED' | 'NO_PDFA_ID' | 'NO_OUTPUT_INTENT' | 'FONT_NOT_EMBEDDED' | 'JAVASCRIPT' | 'ATTACHMENTS'} code
 * @property {string} message
 * @property {number[]} [pages]
 */

/**
 * @typedef {object} PdfACheck
 * @property {{ part: number, conformance: string } | null} claimed  what the file says it is
 * @property {PdfAProblem[]} problems  empty when none of the checks found anything
 */

/**
 * Look for the usual reasons a file is not PDF/A: encryption, no PDF/A identification, no
 * output intent, fonts that are not embedded, JavaScript, attachments. A clean result means none
 * of these were found, not that the file passes every PDF/A rule.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ part?: 1 | 2 | 3, password?: string }} [options]  part decides whether attachments
 *   count as a problem (they do in parts 1 and 2); default 2
 * @returns {Promise<PdfACheck>}
 */
export async function checkPdfA(input, options = {}) {
  const part = checkPart(options.part ?? 2);
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;
  /** @type {PdfAProblem[]} */
  const problems = [];
  const found = pdf.withDocument(bytes, options, (doc) => {
    /** @type {Map<string, Set<number>>} */
    const fonts = new Map();
    for (let i = 0; i < fn.FPDF_GetPageCount(doc); i++) {
      pdf.withPage(doc, i, (page) => {
        /** @param {number} holder @param {boolean} form */
        const walk = (holder, form) => {
          const count = form ? fn.FPDFFormObj_CountObjects(holder) : fn.FPDFPage_CountObjects(holder);
          for (let k = 0; k < count; k++) {
            const obj = form ? fn.FPDFFormObj_GetObject(holder, k) : fn.FPDFPage_GetObject(holder, k);
            const type = fn.FPDFPageObj_GetType(obj);
            if (type === PAGEOBJ_FORM) walk(obj, true);
            if (type !== PAGEOBJ_TEXT || fn.FPDFTextObj_GetTextRenderMode(obj) === INVISIBLE) continue;
            const font = fn.FPDFTextObj_GetFont(obj);
            if (!font || fn.FPDFFont_GetIsEmbedded(font)) continue;
            const name = fontName(pdf, font);
            fonts.set(name, (fonts.get(name) ?? new Set()).add(i + 1));
          }
        };
        walk(page, false);
      });
    }
    return {
      fonts,
      javascript: fn.FPDFDoc_GetJavaScriptActionCount(doc) > 0,
      attachments: fn.FPDFDoc_GetAttachmentCount(doc),
    };
  });
  for (const [name, pages] of found.fonts) {
    problems.push({ code: 'FONT_NOT_EMBEDDED', message: `The font ${name} is not embedded.`, pages: [...pages] });
  }
  if (found.javascript) problems.push({ code: 'JAVASCRIPT', message: 'The document has JavaScript, which PDF/A does not allow.' });
  if (found.attachments && part < 3) problems.push({ code: 'ATTACHMENTS', message: `The document has ${found.attachments} attachment${found.attachments === 1 ? '' : 's'}; PDF/A-${part} allows ${part === 1 ? 'none' : 'only PDF/A files'}.` });

  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream } = await import('@cantoo/pdf-lib');
  let claimed = null;
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    if (doc.isEncrypted) {
      problems.unshift({ code: 'ENCRYPTED', message: 'The document is encrypted, which PDF/A does not allow.' });
    } else {
      const meta = doc.catalog.lookup(PDFName.of('Metadata'));
      const xmp = meta instanceof PDFRawStream ? new TextDecoder().decode(meta.getContents()) : '';
      const partFound = /pdfaid:part(?:>|=")\s*(\d)/.exec(xmp)?.[1];
      const conformance = /pdfaid:conformance(?:>|=")\s*([ABUabu])/.exec(xmp)?.[1];
      if (partFound) claimed = { part: Number(partFound), conformance: (conformance ?? '').toUpperCase() };
      else problems.push({ code: 'NO_PDFA_ID', message: 'The XMP metadata does not say the file is PDF/A.' });
      const intents = doc.catalog.lookup(PDFName.of('OutputIntents'));
      const hasIntent = intents instanceof PDFArray && intents.asArray().some((ref) => {
        const intent = doc.context.lookup(ref);
        return intent instanceof PDFDict && intent.get(PDFName.of('S'))?.toString() === '/GTS_PDFA1' && intent.has(PDFName.of('DestOutputProfile'));
      });
      if (!hasIntent) problems.push({ code: 'NO_OUTPUT_INTENT', message: 'There is no PDF/A output intent with a colour profile.' });
    }
  } catch {
    // pdf-lib cannot read every file PDFium can; the checks above still stand
  }
  return { claimed, problems };
}

/**
 * Make a PDF as close to PDF/A as can be done without changing how its pages look: PDF/A
 * metadata matching the document's information, an sRGB output intent, document JavaScript
 * removed, no object streams. Fonts that are not embedded cannot be fixed here: checkPdfA()
 * reports them, and converting the source with toPdf({ pdfa }) avoids them.
 *
 * @param {import('./input.js').DocumentInput} input
 * @param {{ part?: 1 | 2 | 3 }} [options]  default 2 (PDF/A-2b)
 * @returns {Promise<Uint8Array>}
 */
export async function toPdfA(input, options = {}) {
  const part = checkPart(options.part ?? 2);
  const bytes = await toPdfBytes(input);
  const { PDFDocument, PDFName, PDFString, PDFHexString } = await import('@cantoo/pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return fail('DAMAGED_FILE', 'The file could not be read to make it PDF/A. Repair it first.');
  }
  if (doc.isEncrypted) fail('UNSUPPORTED_SECURITY', 'PDF/A files cannot be encrypted: decrypt it first.');
  const { catalog, context } = doc;

  // no JavaScript anywhere a reader runs it by itself
  const names = catalog.lookup(PDFName.of('Names'));
  if (names && 'delete' in names) /** @type {any} */ (names).delete(PDFName.of('JavaScript'));
  const open = catalog.lookup(PDFName.of('OpenAction'));
  if (open && 'get' in open && /** @type {any} */ (open).get(PDFName.of('S'))?.toString() === '/JavaScript') catalog.delete(PDFName.of('OpenAction'));
  catalog.delete(PDFName.of('AA'));

  const info = {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    created: doc.getCreationDate(),
    modified: doc.getModificationDate(),
  };
  const xmp = context.stream(xmpPacket(part, info), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), context.register(xmp));

  const profile = context.flateStream(srgbProfile(), { N: 3 });
  const intent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: context.register(profile),
  });
  catalog.set(PDFName.of('OutputIntents'), context.obj([context.register(intent)]));

  // PDF/A needs a file identifier
  if (!context.trailerInfo.ID) {
    const id = PDFHexString.of(identifier(bytes));
    context.trailerInfo.ID = context.obj([id, id]);
  }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** @param {unknown} part */
function checkPart(part) {
  if (part !== 1 && part !== 2 && part !== 3) fail('INVALID_OPTION', 'part must be 1, 2 or 3.');
  return /** @type {1 | 2 | 3} */ (part);
}

/**
 * @param {import('./engine/pdfium.js').Engine} pdf
 * @param {number} font
 */
function fontName(pdf, font) {
  const size = pdf.fn.FPDFFont_GetBaseFontName(font, 0, 0);
  if (size <= 1) return 'without a name';
  const ptr = pdf.malloc(size);
  try {
    pdf.fn.FPDFFont_GetBaseFontName(font, ptr, size);
    return new TextDecoder().decode(pdf.wasm.HEAPU8.subarray(ptr, ptr + size - 1));
  } finally {
    pdf.free(ptr);
  }
}

/**
 * @param {number} part
 * @param {{ title: string, author: string, subject: string, keywords: string, creator: string, producer: string, created?: Date, modified?: Date }} info
 */
export function xmpPacket(part, info) {
  /** @param {string} s */
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /** @param {Date} d */
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    `<pdfaid:part>${part}</pdfaid:part>`,
    '<pdfaid:conformance>B</pdfaid:conformance>',
    info.title && `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(info.title)}</rdf:li></rdf:Alt></dc:title>`,
    info.author && `<dc:creator><rdf:Seq><rdf:li>${esc(info.author)}</rdf:li></rdf:Seq></dc:creator>`,
    info.subject && `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(info.subject)}</rdf:li></rdf:Alt></dc:description>`,
    info.keywords && `<pdf:Keywords>${esc(info.keywords)}</pdf:Keywords>`,
    info.producer && `<pdf:Producer>${esc(info.producer)}</pdf:Producer>`,
    info.creator && `<xmp:CreatorTool>${esc(info.creator)}</xmp:CreatorTool>`,
    info.created && `<xmp:CreateDate>${iso(info.created)}</xmp:CreateDate>`,
    info.modified && `<xmp:ModifyDate>${iso(info.modified)}</xmp:ModifyDate>`,
  ].filter(Boolean);
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    + `${lines.join('')}</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;
}

/**
 * A small sRGB colour profile (ICC version 2, display class), built here so no profile file has
 * to be shipped: D50-adapted sRGB primaries and the sRGB tone curve sampled 256 times.
 */
export function srgbProfile() {
  const s15 = (/** @type {number} */ v) => Math.round(v * 65536);
  /** @param {[number, number, number]} xyz */
  const xyzTag = (xyz) => [...ascii('XYZ '), 0, 0, 0, 0, ...xyz.flatMap((v) => int32(s15(v)))];
  const curve = [...ascii('curv'), 0, 0, 0, 0, ...int32(256)];
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const linear = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const v = Math.round(linear * 65535);
    curve.push(v >> 8, v & 0xff);
  }
  const text = 'sRGB IEC61966-2.1';
  const desc = [...ascii('desc'), 0, 0, 0, 0, ...int32(text.length + 1), ...ascii(text), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...new Array(67).fill(0)];
  const cprt = [...ascii('text'), 0, 0, 0, 0, ...ascii('No copyright, use freely'), 0];
  const tags = /** @type {[string, number[]][]} */ ([
    ['desc', desc],
    ['cprt', cprt],
    ['wtpt', xyzTag([0.9642, 1, 0.8249])],
    ['rXYZ', xyzTag([0.4361, 0.2225, 0.0139])],
    ['gXYZ', xyzTag([0.3851, 0.7169, 0.0971])],
    ['bXYZ', xyzTag([0.1431, 0.0606, 0.7141])],
    ['rTRC', curve],
  ]);
  const shared = /** @type {[string, string][]} */ ([['gTRC', 'rTRC'], ['bTRC', 'rTRC']]);
  const tableSize = 4 + (tags.length + shared.length) * 12;
  let offset = 128 + tableSize;
  /** @type {Map<string, [number, number]>} */
  const placed = new Map();
  const body = [];
  for (const [sig, data] of tags) {
    while (offset % 4) {
      body.push(0);
      offset++;
    }
    placed.set(sig, [offset, data.length]);
    body.push(...data);
    offset += data.length;
  }
  const table = [...int32(tags.length + shared.length)];
  for (const [sig] of tags) table.push(...ascii(sig), ...int32(/** @type {[number, number]} */ (placed.get(sig))[0]), ...int32(/** @type {[number, number]} */ (placed.get(sig))[1]));
  for (const [sig, same] of shared) table.push(...ascii(sig), ...int32(/** @type {[number, number]} */ (placed.get(same))[0]), ...int32(/** @type {[number, number]} */ (placed.get(same))[1]));
  const size = 128 + table.length + body.length;
  const header = [
    ...int32(size), 0, 0, 0, 0, 0x02, 0x10, 0, 0, ...ascii('mntr'), ...ascii('RGB '), ...ascii('XYZ '),
    0x07, 0xd0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, // 2000-01-01 00:00:00
    ...ascii('acsp'), ...new Array(4 + 4 + 4 + 4 + 8 + 4).fill(0),
    ...int32(s15(0.9642)), ...int32(s15(1)), ...int32(s15(0.8249)),
    ...new Array(4 + 16 + 28).fill(0),
  ];
  return new Uint8Array([...header, ...table, ...body]);
}

/** @param {string} s */
function ascii(s) {
  return [...s].map((c) => c.charCodeAt(0));
}

/** @param {number} n */
function int32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/**
 * A stable identifier from the file's bytes (FNV-1a, 128 bits as four lanes).
 *
 * @param {Uint8Array} bytes
 */
function identifier(bytes) {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < bytes.length; i++) {
    const lane = i & 3;
    lanes[lane] = Math.imul(lanes[lane] ^ bytes[i], 0x01000193) >>> 0;
  }
  return lanes.map((n) => n.toString(16).padStart(8, '0')).join('').toUpperCase();
}
