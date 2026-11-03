// PDF to Word as flowing text: the paragraphs, headings, list items and table rows that flow.js
// finds, written as ordinary Word paragraphs in styles a person would use. Typing into them
// reflows the text. It is an editable draft, not a copy of the look: lines, shapes and charts
// drawn in the PDF are left out, and Word wraps the lines its own way.
import { flowBlocks } from './flow.js';
import { xml, XML_HEAD } from './ooxml.js';
import { fail } from '../errors.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// page margins are kept between a quarter of an inch and an inch and a half
const MIN_MARGIN = 18;
const MAX_MARGIN = 108;
// Word refuses pages over 22 inches
const MAX_POINTS = 22 * 72;

/** @typedef {import('./flow.js').Block} Block */
/** @typedef {import('./flow.js').FlowPage} FlowPage */
/** @typedef {import('./layout.js').Run} Run */

/**
 * The style a run is written against: only what differs is written on the run.
 *
 * @typedef {{ font: string, bold: boolean, italic: boolean, size: number, color: string }} Style
 */

/**
 * The document and its styles, as WordprocessingML.
 *
 * @param {import('./layout.js').PageLayout[]} pages  from readLayout
 * @param {{ pageBreaks: boolean }} options
 * @returns {{ document: string, styles: string }}
 */
export function flowParts(pages, options) {
  const { body, pages: flowed } = flowBlocks(pages);
  if (!body) fail('CONVERSION_FAILED', 'The PDF has no text to flow; it may be a scan. Run it through OCR first (opendocs ocr), then convert it again.');
  /** @type {Style} */
  const normal = { font: body.font, bold: false, italic: false, size: half(body.size), color: body.color };
  const headings = [1, 2, 3].map((level) => headingStyle(flowed, level, normal));

  // a section for each run of pages of one size, so a page size change starts a new one
  /** @type {FlowPage[][]} */
  const sections = [];
  for (const page of flowed.filter((p) => p.blocks.length)) {
    const last = sections.at(-1)?.[0];
    if (last && last.width === page.width && last.height === page.height) /** @type {FlowPage[]} */ (sections.at(-1)).push(page);
    else sections.push([page]);
  }

  const paragraphs = sections.flatMap((group, s) => {
    const margins = marginsOf(group);
    const section = sectionOf(group[0], margins);
    const final = s === sections.length - 1;
    const out = group.flatMap((page, p) => page.blocks.map((block, b) => paragraph(block, {
      margin: margins.left,
      normal,
      headings,
      pageBreak: options.pageBreaks && p > 0 && b === 0,
      // a section's properties go in its last paragraph; the last section's close the body
      section: !final && p === group.length - 1 && b === page.blocks.length - 1 ? section : '',
    })));
    return final ? [...out, section] : out;
  });

  return {
    document: `${XML_HEAD}<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}</w:body></w:document>`,
    styles: stylesOf(normal, headings),
  };
}

/**
 * @param {Block} block
 * @param {{ margin: number, normal: Style, headings: Style[], pageBreak: boolean, section: string }} context
 */
function paragraph(block, context) {
  const base = block.kind === 'heading' ? context.headings[block.level - 1] : context.normal;
  const props = [];
  if (block.kind === 'heading') props.push(`<w:pStyle w:val="Heading${block.level}"/>`);
  else if (block.kind === 'item') props.push('<w:pStyle w:val="ListParagraph"/>');
  if (context.pageBreak) props.push('<w:pageBreakBefore/>');
  // indents count from the margin, or from the left of the column the block was set in: in
  // flowing text a column is simply the paragraphs after the column before it
  const origin = block.origin ?? context.margin;
  if (block.tabs.length) props.push(`<w:tabs>${block.tabs.map((t) => `<w:tab w:val="left" w:pos="${twips(Math.max(0, t - origin))}"/>`).join('')}</w:tabs>`);
  if (block.before) props.push(`<w:spacing w:before="${twips(block.before)}"/>`);
  if (block.align === 'left') {
    const left = Math.max(0, block.left - origin);
    const first = block.first - block.left;
    const extra = first > 0.5 ? ` w:firstLine="${twips(first)}"` : first < -0.5 ? ` w:hanging="${twips(-first)}"` : '';
    // a list item always says where its text starts, so the marker hangs to its left
    if (left > 0.5 || extra || block.kind === 'item') props.push(`<w:ind w:left="${twips(left)}"${extra}/>`);
  } else {
    props.push(`<w:jc w:val="${block.align}"/>`);
  }
  if (context.section) props.push(context.section);
  const runs = block.pieces.map((piece) => ('text' in piece ? run(piece, base) : 'tab' in piece ? '<w:r><w:tab/></w:r>' : '<w:r><w:br/></w:r>'));
  return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${runs.join('')}</w:p>`;
}

/**
 * @param {Run} r
 * @param {Style} base
 */
function run(r, base) {
  const props = [];
  if (r.font !== base.font) {
    const font = xml(r.font);
    props.push(`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`);
  }
  if (r.bold !== base.bold) props.push(r.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (r.italic !== base.italic) props.push(r.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (r.color !== base.color) props.push(`<w:color w:val="${r.color}"/>`);
  const size = half(r.size);
  if (size !== base.size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  return `<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
}

/**
 * A heading level's style, from the first heading set at that level; levels no heading uses get
 * a bold face a step larger than the body.
 *
 * @param {FlowPage[]} pages
 * @param {number} level
 * @param {Style} normal
 * @returns {Style}
 */
function headingStyle(pages, level, normal) {
  const block = pages.flatMap((p) => p.blocks).find((b) => b.kind === 'heading' && b.level === level);
  const runs = /** @type {Run[]} */ (block?.pieces.filter((p) => 'text' in p && p.text.trim()) ?? []);
  if (!block || !runs.length) return { ...normal, bold: true, size: half(normal.size / 2 * [1.6, 1.3, 1.15][level - 1]) };
  const [first] = runs;
  return { font: first.font, bold: runs.every((r) => r.bold), italic: runs.every((r) => r.italic), size: half(block.size), color: first.color };
}

/**
 * @param {Style} normal
 * @param {Style[]} headings
 */
function stylesOf(normal, headings) {
  /** @param {Style} style @param {Style} [under] */
  const props = (style, under) => {
    const font = xml(style.font);
    return [
      !under || style.font !== under.font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>` : '',
      style.bold && !under?.bold ? '<w:b/><w:bCs/>' : '',
      style.italic && !under?.italic ? '<w:i/><w:iCs/>' : '',
      !under || style.color !== under.color ? `<w:color w:val="${style.color}"/>` : '',
      !under || style.size !== under.size ? `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>` : '',
    ].join('');
  };
  const heading = headings.map((style, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/>`
    + '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>'
    + `<w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr>${props(style, normal)}</w:rPr></w:style>`);
  return `${XML_HEAD}<w:styles xmlns:w="${W}"><w:docDefaults>`
    + `<w:rPrDefault><w:rPr>${props(normal)}</w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading.join('')
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/></w:style>'
    + '</w:styles>';
}

/**
 * The margins of a run of pages: as close to the edges as the text comes on any of them.
 *
 * @param {FlowPage[]} pages
 */
function marginsOf(pages) {
  /** @param {'top' | 'right' | 'bottom' | 'left'} side */
  const side = (side) => Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, Math.min(...pages.map((p) => p.margins?.[side] ?? MAX_MARGIN))));
  return { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
}

/**
 * @param {FlowPage} page
 * @param {{ top: number, right: number, bottom: number, left: number }} margins
 */
function sectionOf(page, margins) {
  const w = twips(Math.min(page.width, MAX_POINTS));
  const h = twips(Math.min(page.height, MAX_POINTS));
  return `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${w > h ? ' w:orient="landscape"' : ''}/>`
    + `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

/** @param {number} points */
function twips(points) {
  return Math.round(points * 20);
}

/**
 * Points to Word's half points.
 *
 * @param {number} points
 */
function half(points) {
  return Math.round(points * 2);
}
