// Test documents built from code, so every test knows exactly what is inside.
// Output is deterministic: the same options always give the same bytes. The one exception is
// encrypted files, where AES needs a fresh random IV for every string and stream.

import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from '@cantoo/pdf-lib';

export const FIXED_DATE = new Date('2020-01-01T00:00:00Z');

export const PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89],
  legal: [612, 1008],
};

export const DEFAULT_METADATA = {
  title: 'Fixture',
  author: 'Open Documents fixtures',
  subject: 'Test document',
  keywords: ['fixture', 'test'],
  creator: 'open-documents fixtures',
  producer: 'open-documents fixtures',
};

/**
 * @typedef {object} PageTruth
 * @property {number} width   width in points, before rotation
 * @property {number} height  height in points, before rotation
 * @property {number} rotation  0, 90, 180 or 270
 * @property {string[]} lines  text lines, top to bottom
 */

/**
 * @typedef {object} Bookmark
 * @property {string} title
 * @property {number} page  1-based
 */

/**
 * @typedef {object} Attachment
 * @property {string} name
 * @property {Uint8Array} data
 * @property {string} [mimeType]
 */

/**
 * @typedef {object} Encryption
 * @property {string} [userPassword]   needed to open the file
 * @property {string} [ownerPassword]  lifts the permission limits
 * @property {{ printing?: boolean, modifying?: boolean, copying?: boolean, annotating?: boolean }} [permissions]
 */

/**
 * @typedef {object} Truth
 * @property {PageTruth[]} pages
 * @property {typeof DEFAULT_METADATA} metadata
 * @property {Bookmark[]} bookmarks
 * @property {string[]} attachments  names
 * @property {Encryption | null} encryption
 */

/**
 * @typedef {object} Fixture
 * @property {Uint8Array} bytes
 * @property {Truth} truth
 */

/**
 * @param {number} n  1-based page number
 * @param {number} total
 */
export function defaultLines(n, total) {
  return [`Page ${n} of ${total}`, 'The quick brown fox jumps over the lazy dog.'];
}

/**
 * A plain document with a few lines of Helvetica on each page.
 *
 * @param {object} [options]
 * @param {number} [options.pages]
 * @param {keyof PAGE_SIZES | [number, number]} [options.size]
 * @param {number | number[]} [options.rotation]  one value for all pages, or one per page
 * @param {(n: number, total: number) => string[]} [options.lines]
 * @param {Partial<typeof DEFAULT_METADATA>} [options.metadata]
 * @param {Bookmark[]} [options.bookmarks]  top-level outline entries
 * @param {Attachment[]} [options.attachments]
 * @param {Encryption} [options.encrypt]  AES-128. pdf-lib leaves the metadata strings
 *   unencrypted, which breaks the spec, so readers see empty metadata in these files.
 * @returns {Promise<Fixture>}
 */
export async function textDocument(options = {}) {
  const {
    pages = 3,
    size = 'letter',
    rotation = 0,
    lines = defaultLines,
    metadata = {},
    bookmarks = [],
    attachments = [],
    encrypt,
  } = options;
  const [width, height] = typeof size === 'string' ? PAGE_SIZES[size] : size;
  const meta = { ...DEFAULT_METADATA, ...metadata };

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  /** @type {PageTruth[]} */
  const truthPages = [];

  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([width, height]);
    const pageLines = lines(n, pages);
    pageLines.forEach((text, i) => {
      page.drawText(text, { x: 72, y: height - 72 - i * 18, size: 12, font });
    });
    const turn = Array.isArray(rotation) ? (rotation[n - 1] ?? 0) : rotation;
    if (turn) page.setRotation(degrees(turn));
    truthPages.push({ width, height, rotation: turn, lines: pageLines });
  }

  setMetadata(doc, meta);
  if (bookmarks.length) addOutline(doc, bookmarks);
  for (const a of attachments) {
    await doc.attach(a.data, a.name, {
      mimeType: a.mimeType ?? 'application/octet-stream',
      creationDate: FIXED_DATE,
      modificationDate: FIXED_DATE,
    });
  }
  if (encrypt) doc.encrypt({ ownerPassword: 'owner', ...encrypt });
  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes,
    truth: {
      pages: truthPages,
      metadata: meta,
      bookmarks,
      attachments: attachments.map((a) => a.name),
      encryption: encrypt ? { ownerPassword: 'owner', ...encrypt } : null,
    },
  };
}

/** The figures in reportDocument's table, header row first. */
export const REPORT_TABLE = [
  ['Region', 'Revenue', 'Costs'],
  ['North', '1200', '800'],
  ['South', '950', '700'],
  ['West', '1430', '910'],
];

/**
 * A two-page report with structure to find: a heading, a paragraph and a ruled table on the
 * first page, another heading and a line of text on the second.
 *
 * @returns {Promise<Fixture>}
 */
export async function reportDocument() {
  const doc = await PDFDocument.create();
  setMetadata(doc, { ...DEFAULT_METADATA, title: 'Quarterly Report' });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage(PAGE_SIZES.letter);
  first.drawText('Quarterly Report', { x: 72, y: 700, size: 22, font: bold });
  first.drawText('Revenue grew in every region, and costs stayed flat against the plan.', { x: 72, y: 660, size: 11, font });
  const [left, top, column, row] = [72, 620, 150, 22];
  REPORT_TABLE.forEach((cells, i) => cells.forEach((text, j) => {
    first.drawText(text, { x: left + j * column + 6, y: top - i * row - 15, size: 11, font: i === 0 ? bold : font });
  }));
  for (let i = 0; i <= REPORT_TABLE.length; i++) {
    first.drawLine({ start: { x: left, y: top - i * row }, end: { x: left + 3 * column, y: top - i * row }, thickness: 0.8 });
  }
  for (let j = 0; j <= 3; j++) {
    first.drawLine({ start: { x: left + j * column, y: top }, end: { x: left + j * column, y: top - REPORT_TABLE.length * row }, thickness: 0.8 });
  }
  const second = doc.addPage(PAGE_SIZES.letter);
  second.drawText('Second page', { x: 72, y: 700, size: 22, font: bold });
  second.drawText('Only words here.', { x: 72, y: 660, size: 11, font });
  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes,
    truth: {
      metadata: { ...DEFAULT_METADATA, title: 'Quarterly Report' },
      pages: [
        { width: 612, height: 792, rotation: 0, lines: ['Quarterly Report', 'Revenue grew in every region, and costs stayed flat against the plan.', ...REPORT_TABLE.map((r) => r.join(' '))] },
        { width: 612, height: 792, rotation: 0, lines: ['Second page', 'Only words here.'] },
      ],
      bookmarks: [],
      attachments: [],
      encryption: null,
    },
  };
}

/**
 * A one-page form: a filled text field, a ticked check box, a dropdown and an empty field.
 *
 * @returns {Promise<Fixture & { fields: Record<string, string | boolean> }>}
 */
export async function formDocument() {
  const doc = await PDFDocument.create();
  const page = doc.addPage(PAGE_SIZES.letter);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Application', { x: 72, y: 720, size: 18, font });
  const form = doc.getForm();

  const name = form.createTextField('name');
  name.setText('Sample Person');
  name.addToPage(page, { x: 72, y: 640, width: 240, height: 24, font });

  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 72, y: 600, width: 16, height: 16 });
  agree.check();

  const colour = form.createDropdown('colour');
  colour.addOptions(['red', 'green', 'blue']);
  colour.select('green');
  colour.addToPage(page, { x: 72, y: 560, width: 120, height: 24, font });

  const notes = form.createTextField('notes');
  notes.addToPage(page, { x: 72, y: 500, width: 240, height: 48, font });

  setMetadata(doc, DEFAULT_METADATA);
  const bytes = await doc.save({ useObjectStreams: false });
  const fields = { name: 'Sample Person', agree: true, colour: 'green', notes: '' };
  return {
    bytes,
    fields,
    truth: {
      pages: [{ width: 612, height: 792, rotation: 0, lines: ['Application'] }],
      metadata: DEFAULT_METADATA,
      bookmarks: [],
      attachments: [],
      encryption: null,
    },
  };
}

/**
 * A heading written one letter per text object, each under a scaled transform, the way
 * Chromium writes some text. PDFium's own text extraction breaks such words into one letter
 * per line.
 *
 * @param {string} [text]
 * @returns {Promise<Fixture>}
 */
export async function splitLettersDocument(text = 'Notes') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(PAGE_SIZES.letter);
  let x = 72;
  for (const ch of text) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(0.75, 0, 0, 0.75, 0, 0));
    page.drawText(ch, { x: x / 0.75, y: 700 / 0.75, size: 32, font });
    page.pushOperators(popGraphicsState());
    x += font.widthOfTextAtSize(ch, 24) + 0.5;
  }
  setMetadata(doc, DEFAULT_METADATA);
  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes,
    truth: { pages: [{ width: 612, height: 792, rotation: 0, lines: [text] }], metadata: DEFAULT_METADATA, bookmarks: [], attachments: [], encryption: null },
  };
}

/**
 * A text document whose cross-reference table points at the wrong places, the most common
 * kind of damage in files that were cut short or edited badly. Readers that rebuild the table
 * by scanning the file can still open it.
 *
 * @param {object} [options]  as for textDocument
 * @returns {Promise<Fixture>}
 */
export async function damagedDocument(options = {}) {
  const fixture = await textDocument({ pages: 2, ...options });
  // byte for byte: TextDecoder's 'latin1' is really windows-1252 and would change bytes 0x80 to 0x9f
  let text = Array.from(fixture.bytes, (b) => String.fromCharCode(b)).join('');
  text = text.replace(/(\d{10}) (\d{5}) n/g, (_, offset, gen) => `${String(Number(offset) + 7).padStart(10, '0')} ${gen} n`);
  text = text.replace(/startxref\s+(\d+)/, (_, n) => `startxref\n${String(Number(n) + 13)}`);
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
  return { bytes, truth: fixture.truth };
}

/**
 * pdf-lib has no outline API, so build the dictionaries by hand: a flat list of entries,
 * each pointing at the top of its page.
 *
 * @param {PDFDocument} doc
 * @param {Bookmark[]} bookmarks
 */
function addOutline(doc, bookmarks) {
  const { context } = doc;
  const pages = doc.getPages();
  const outlineRef = context.nextRef();
  const refs = bookmarks.map(() => context.nextRef());
  bookmarks.forEach((b, i) => {
    const page = pages[b.page - 1];
    /** @type {Record<string, any>} */
    const entry = {
      Title: PDFString.of(b.title),
      Parent: outlineRef,
      Dest: [page.ref, PDFName.of('XYZ'), 0, page.getHeight(), 0],
    };
    if (i > 0) entry.Prev = refs[i - 1];
    if (i < refs.length - 1) entry.Next = refs[i + 1];
    context.assign(refs[i], context.obj(entry));
  });
  context.assign(
    outlineRef,
    context.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: refs.length }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlineRef);
}

/**
 * @param {PDFDocument} doc
 * @param {typeof DEFAULT_METADATA} meta
 */
function setMetadata(doc, meta) {
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(meta.keywords);
  doc.setCreator(meta.creator);
  doc.setProducer(meta.producer);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
}
export { pngImage, jpegImage, tiffImage } from './images.js';
export { docxDocument, docxWithLinkedImage, pptxDocument, xlsxDocument, odtDocument, rtfDocument, csvDocument, REPORT } from './office.js';
export { emlMessage, msgMessage } from './email.js';
