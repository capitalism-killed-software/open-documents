// PDF to PowerPoint: one slide per page, the page's picture behind and its text in text boxes
// where it was. A presentation has one slide size, so pages of another size are scaled to fit
// and centred. Charts, tables and shapes stay part of the picture.
import { readLayout } from './layout.js';
import { xml, emu, placeBox, zipOffice, XML_HEAD } from './ooxml.js';

const LINE = 1.2;
const ASCENT = 1.0;
// PowerPoint's slide sizes run from 1 to 56 inches
const MIN_POINTS = 72;
const MAX_POINTS = 56 * 72;

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS = (/** @type {string} */ body) => `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const EMPTY_TREE = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/**
 * PDF to PowerPoint (.pptx), one slide per page.
 *
 * @param {import('../input.js').DocumentInput} input
 * @param {import('./layout.js').LayoutOptions} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function toPptx(input, options = {}) {
  const { title, author, pages } = await readLayout(input, options);
  const first = pages[0];
  const fit = Math.min(1, MAX_POINTS / Math.max(first.width, first.height));
  const slideW = Math.max(MIN_POINTS, first.width * fit);
  const slideH = Math.max(MIN_POINTS, first.height * fit);

  /** @type {Record<string, string | Uint8Array>} */
  const files = {};
  pages.forEach((page, index) => {
    const n = index + 1;
    const scale = Math.min(slideW / page.width, slideH / page.height);
    const ox = (slideW - page.width * scale) / 2;
    const oy = (slideH - page.height * scale) / 2;
    let id = 2;
    /** @type {string[]} */
    const shapes = [];
    let rels = `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;
    if (page.background) {
      files[`ppt/media/page${n}.png`] = page.background.png;
      rels += `<Relationship Id="rId2" Type="${REL}/image" Target="../media/page${n}.png"/>`;
      shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Page ${n}"/><p:cNvPicPr><a:picLocks noGrp="1" noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
        + '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        + `<p:spPr><a:xfrm><a:off x="${emu(ox)}" y="${emu(oy)}"/><a:ext cx="${emu(page.width * scale)}" cy="${emu(page.height * scale)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      id++;
    }
    for (const segment of page.segments) shapes.push(textBox(id++, segment, scale, ox, oy));
    files[`ppt/slides/slide${n}.xml`] = `${XML_HEAD}<p:sld ${NS}><p:cSld><p:spTree>${EMPTY_TREE}${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = RELS(rels);
  });

  const slides = pages.map((_, i) => i + 1);
  return zipOffice({
    '[Content_Types].xml': `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + slides.map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>',
    '_rels/.rels': RELS(`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'),
    'docProps/core.xml': `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">`
      + `<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator></cp:coreProperties>`,
    'ppt/presentation.xml': `${XML_HEAD}<p:presentation ${NS}>`
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>'
      + `<p:sldIdLst>${slides.map((n) => `<p:sldId id="${255 + n}" r:id="rIdSlide${n}"/>`).join('')}</p:sldIdLst>`
      + `<p:sldSz cx="${emu(slideW)}" cy="${emu(slideH)}"/><p:notesSz cx="${emu(slideH)}" cy="${emu(slideW)}"/>`
      + '</p:presentation>',
    'ppt/_rels/presentation.xml.rels': RELS(`<Relationship Id="rIdMaster" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
      + `<Relationship Id="rIdTheme" Type="${REL}/theme" Target="theme/theme1.xml"/>`
      + slides.map((n) => `<Relationship Id="rIdSlide${n}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`).join('')),
    'ppt/slideMasters/slideMaster1.xml': `${XML_HEAD}<p:sldMaster ${NS}><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>`
      + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': RELS(`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
      + `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/>`),
    'ppt/slideLayouts/slideLayout1.xml': `${XML_HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': RELS(`<Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`),
    'ppt/theme/theme1.xml': THEME,
    ...files,
  });
}

/**
 * @param {number} id
 * @param {import('./layout.js').Segment} segment
 * @param {number} scale
 * @param {number} ox  where the page starts on the slide
 * @param {number} oy
 */
function textBox(id, segment, scale, ox, oy) {
  const size = Math.max(segment.size, 1) * scale;
  const height = size * LINE;
  const width = Math.max(segment.width * scale * 1.05 + size * 0.5, size);
  const x = ox + segment.x * scale;
  const y = oy + segment.y * scale;
  const vertical = segment.angle === 90 ? 'vert' : segment.angle === 270 ? 'vert270' : '';
  const box = vertical === 'vert'
    ? { x: x + size * ASCENT - height, y, cx: height, cy: width }
    : vertical === 'vert270'
      ? { x: x - size * ASCENT, y: y - width, cx: height, cy: width }
      : { ...placeBox({ x, y, angle: segment.angle }, width, height, size * ASCENT), cx: width, cy: height };
  const rot = segment.angle && !vertical ? ` rot="${Math.round(segment.angle * 60000)}"` : '';
  const runs = segment.runs.map((run) => {
    const font = xml(run.font);
    const sz = Math.min(400000, Math.max(100, Math.round(run.size * scale * 100)));
    return `<a:r><a:rPr lang="en-US" sz="${sz}" b="${run.bold ? 1 : 0}" i="${run.italic ? 1 : 0}" dirty="0">`
      + `<a:solidFill><a:srgbClr val="${run.color}"/></a:solidFill><a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:rPr>`
      + `<a:t>${xml(run.text)}</a:t></a:r>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm${rot}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.cx)}" cy="${emu(box.cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"${vertical ? ` vert="${vertical}"` : ''}><a:noAutofit/></a:bodyPr><a:lstStyle/>`
    + `<a:p><a:pPr><a:lnSpc><a:spcPts val="${Math.round(height * 100)}"/></a:lnSpc></a:pPr>${runs}</a:p></p:txBody></p:sp>`;
}

// The smallest theme PowerPoint accepts: colours, fonts and the three-of-each style lists.
const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const line = `<a:ln w="9525">${fill}</a:ln>`;
const THEME = `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Open Documents"><a:themeElements>`
  + '<a:clrScheme name="Open Documents"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>'
  + '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>'
  + ['2563EB', 'DC2626', '16A34A', 'D97706', '7C3AED', '0891B2'].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('')
  + '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>'
  + '<a:fontScheme name="Open Documents"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
  + '<a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>'
  + `<a:fmtScheme name="Open Documents"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>`
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
