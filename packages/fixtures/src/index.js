// Test documents built from code, so every test knows exactly what is inside.
// Output is deterministic: the same options always give the same bytes.

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';

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
 * @typedef {object} Truth
 * @property {PageTruth[]} pages
 * @property {typeof DEFAULT_METADATA} metadata
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
 * @returns {Promise<Fixture>}
 */
export async function textDocument(options = {}) {
  const {
    pages = 3,
    size = 'letter',
    rotation = 0,
    lines = defaultLines,
    metadata = {},
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
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, truth: { pages: truthPages, metadata: meta } };
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
