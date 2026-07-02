// PDF to Word, keeping the layout exactly: each page becomes a section the size of the page,
// every stretch of text an unframed text box where it was, in its font, size and colour, and
// everything else one picture behind the text. The text can be edited and searched; it does not
// flow from line to line the way text typed into Word does.
import { readLayout } from './layout.js';
import { xml, emu, placeBox, zipOffice, XML_HEAD } from './ooxml.js';

// How Word and LibreOffice set a line of exactly LINE times the font size: the baseline sits
// about ASCENT times the size below the top. Measured by converting back to PDF and comparing.
const LINE = 1.2;
const ASCENT = 0.96;
// Word refuses pages over 22 inches; bigger pages are scaled to fit.
const MAX_POINTS = 22 * 72;

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
};

/**
 * @typedef {import('./layout.js').LayoutOptions} DocxOptions
 */

/**
 * PDF to Word (.docx), keeping each page's layout: text boxes for the text, a picture for the
 * rest.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {DocxOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function toDocx(input, options = {}) {
  const { title, author, pages } = await readLayout(input, options);
  /** @type {Record<string, string | Uint8Array>} */
  const media = {};
  /** @type {string[]} */
  const rels = [];
  let id = 1;
  const body = pages.map((page, index) => {
    const scale = Math.min(1, MAX_POINTS / Math.max(page.width, page.height));
    /** @type {string[]} */
    const drawings = [];
    if (page.background) {
      const name = `page${page.page}.png`;
      const rel = `rIdImage${index + 1}`;
      media[`word/media/${name}`] = page.background.png;
      rels.push(`<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      drawings.push(picture(id++, rel, name, page.width * scale, page.height * scale));
    }
    for (const segment of page.segments) drawings.push(textBox(id++, segment, scale));
    const section = sectionOf(page.width * scale, page.height * scale);
    const last = index === pages.length - 1;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${last ? '' : section}</w:pPr>${drawings.join('')}</w:p>`
      + (last ? section : '');
  });

  const document = `${XML_HEAD}<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:wps="${NS.wps}" xmlns:mc="${NS.mc}"><w:body>${body.join('')}</w:body></w:document>`;
  return zipOffice({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>',
    '_rels/.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>',
    'docProps/core.xml': `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">`
      + `<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator></cp:coreProperties>`,
    'word/document.xml': document,
    'word/styles.xml': `${XML_HEAD}<w:styles xmlns:w="${NS.w}"><w:docDefaults>`
      + '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault>'
      + '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    'word/_rels/document.xml.rels': `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + `${rels.join('')}</Relationships>`,
    ...media,
  });
}

/**
 * A section exactly the size of the page, with no margins.
 *
 * @param {number} width   points
 * @param {number} height
 */
function sectionOf(width, height) {
  const w = Math.round(width * 20);
  const h = Math.round(height * 20);
  return `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${w > h ? ' w:orient="landscape"' : ''}/>`
    + '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
}

/**
 * A picture of the page, behind the text.
 *
 * @param {number} id
 * @param {string} rel
 * @param {string} name
 * @param {number} width   points
 * @param {number} height
 */
function picture(id, rel, name, width, height) {
  const cx = emu(width);
  const cy = emu(height);
  return '<w:r><w:drawing>'
    + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">`
    + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>'
    + '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`
    + `<wp:docPr id="${id}" name="Page background ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
}

/**
 * A text box with no border or fill, holding one stretch of text on its baseline.
 *
 * @param {number} id
 * @param {import('./layout.js').Segment} segment
 * @param {number} scale
 */
function textBox(id, segment, scale) {
  const size = Math.max(segment.size, 1) * scale;
  const height = size * LINE;
  // a little room at the end, because Word's copy of a font is rarely the PDF's to the point
  const width = Math.max(segment.width * scale * 1.05 + size * 0.5, size);
  const x = segment.x * scale;
  const y = segment.y * scale;
  // Text turned a quarter either way is written as vertical text in an upright box, which every
  // reader understands; other angles turn the box itself, which LibreOffice ignores.
  const vertical = segment.angle === 90 ? 'vert' : segment.angle === 270 ? 'vert270' : '';
  const box = vertical === 'vert'
    ? { x: x + size * ASCENT - height, y, cx: height, cy: width }
    : vertical === 'vert270'
      ? { x: x - size * ASCENT, y: y - width, cx: height, cy: width }
      : { ...placeBox({ x, y, angle: segment.angle }, width, height, size * ASCENT), cx: width, cy: height };
  const runs = segment.runs.map((run) => {
    const half = Math.max(2, Math.round(run.size * scale * 2));
    const font = xml(run.font);
    return `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`
      + `${run.bold ? '<w:b/><w:bCs/>' : ''}${run.italic ? '<w:i/><w:iCs/>' : ''}<w:color w:val="${run.color}"/>`
      + `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr><w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`;
  }).join('');
  const rot = segment.angle && !vertical ? ` rot="${Math.round(segment.angle * 60000)}"` : '';
  const cx = emu(box.cx);
  const cy = emu(box.cy);
  return '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>'
    + `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
    + `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(box.x)}</wp:posOffset></wp:positionH>`
    + `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(box.y)}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`
    + `<wp:docPr id="${id}" name="Text ${id}"/><wp:cNvGraphicFramePr/>`
    + '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp>'
    + '<wps:cNvSpPr txBox="1"/>'
    + `<wps:spPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>`
    + `<wps:txbx><w:txbxContent><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round(height * 20)}" w:lineRule="exact"/></w:pPr>${runs}</w:p></w:txbxContent></wps:txbx>`
    + `<wps:bodyPr rot="0"${vertical ? ` vert="${vertical}"` : ''} wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>`
    + '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r>';
}
