// Office documents built in code, each with the text it must come out with once converted.
// DOCX and PPTX use their libraries; XLSX, ODT, RTF and CSV are small enough to write by hand.
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { zipSync, strToU8 } from 'fflate';

/**
 * @typedef {object} OfficeFixture
 * @property {Uint8Array} bytes
 * @property {string} ext       file extension, without the dot
 * @property {string[]} words   words that must appear in the converted PDF's text
 */

export const REPORT = {
  title: 'Quarterly Report',
  paragraphs: ['Revenue grew in every region.', 'Costs stayed flat against plan.'],
  table: [
    ['Region', 'Revenue'],
    ['North', '1200'],
    ['South', '950'],
  ],
};

const xml = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wordsOf = (/** @type {string[]} */ ...texts) => texts.join(' ').split(/\s+/).filter(Boolean);

/** @returns {Promise<OfficeFixture>} */
export async function docxDocument() {
  const doc = new Document({
    creator: 'open-documents fixtures',
    title: REPORT.title,
    sections: [
      {
        children: [
          new Paragraph({ text: REPORT.title, heading: HeadingLevel.HEADING_1 }),
          ...REPORT.paragraphs.map((p) => new Paragraph({ children: [new TextRun(p)] })),
          new Table({
            rows: REPORT.table.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })) })),
          }),
        ],
      },
    ],
  });
  const bytes = new Uint8Array(await Packer.toBuffer(doc));
  return { bytes, ext: 'docx', words: wordsOf(REPORT.title, ...REPORT.paragraphs, ...REPORT.table.flat()) };
}

/** @returns {Promise<OfficeFixture>} */
export async function pptxDocument() {
  const pptx = new PptxGenJS();
  pptx.title = REPORT.title;
  const first = pptx.addSlide();
  first.addText(REPORT.title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32 });
  const second = pptx.addSlide();
  second.addText(REPORT.paragraphs.join('\n'), { x: 0.5, y: 0.5, w: 9, h: 2, fontSize: 18 });
  const bytes = /** @type {Uint8Array} */ (await pptx.write({ outputType: 'uint8array' }));
  return { bytes, ext: 'pptx', words: wordsOf(REPORT.title, ...REPORT.paragraphs) };
}

/** A one-sheet workbook with inline strings and numbers. @returns {OfficeFixture} */
export function xlsxDocument() {
  const cols = 'ABCDEFGHIJ';
  const rows = REPORT.table
    .map((row, r) => `<row r="${r + 1}">${row
      .map((cell, c) => {
        const ref = `${cols[c]}${r + 1}`;
        return /^\d+$/.test(cell) ? `<c r="${ref}"><v>${cell}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
      })
      .join('')}</row>`)
    .join('');
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  return { bytes: zip(files), ext: 'xlsx', words: wordsOf(...REPORT.table.flat()) };
}

/** An OpenDocument text file. @returns {OfficeFixture} */
export function odtDocument() {
  const body = [`<text:h text:outline-level="1">${xml(REPORT.title)}</text:h>`, ...REPORT.paragraphs.map((p) => `<text:p>${xml(p)}</text:p>`)].join('');
  const files = {
    mimetype: 'application/vnd.oasis.opendocument.text',
    'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
  };
  return { bytes: zip(files), ext: 'odt', words: wordsOf(REPORT.title, ...REPORT.paragraphs) };
}

/** @returns {OfficeFixture} */
export function rtfDocument() {
  const text = [`{\\b ${REPORT.title}}\\par`, ...REPORT.paragraphs.map((p) => `${p}\\par`)].join('\n');
  return { bytes: strToU8(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}}\\f0\\fs24\n${text}\n}`), ext: 'rtf', words: wordsOf(REPORT.title, ...REPORT.paragraphs) };
}

/** @returns {OfficeFixture} */
export function csvDocument() {
  return { bytes: strToU8(REPORT.table.map((r) => r.join(',')).join('\n') + '\n'), ext: 'csv', words: wordsOf(...REPORT.table.flat()) };
}

/**
 * The mimetype entry of an OpenDocument file must come first and be stored, not compressed.
 *
 * @param {Record<string, string>} files
 */
function zip(files) {
  /** @type {Record<string, [Uint8Array, { level: 0 | 6, mtime: Date }]>} */
  const entries = {};
  const mtime = new Date('2020-01-01T00:00:00Z');
  for (const [name, text] of Object.entries(files)) entries[name] = [strToU8(text), { level: name === 'mimetype' ? 0 : 6, mtime }];
  return zipSync(entries);
}
