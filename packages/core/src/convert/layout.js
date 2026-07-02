// What a page looks like, in a form that office files can rebuild: lines of styled text placed
// where they are shown, and a picture of everything that is not text. Shared by the Word and
// PowerPoint writers.
import { engine } from '../engine/pdfium.js';
import { toPdfBytes } from '../input.js';
import { selectPages } from '../modify.js';
import { layout, unrotate } from '../text.js';
import { drawPage, FPDF_ANNOT } from '../render.js';
import { encodePng } from '../png.js';
import { numberIn } from '../options.js';
import { fail } from '../errors.js';

const PAGEOBJ_TEXT = 1;
const PAGEOBJ_FORM = 5;
const RENDER_INVISIBLE = 3;
const RENDER_CLIP = 7;
const ITALIC_FLAG = 0x40;
const WHITE = 0xffffffff;

/**
 * A stretch of text in one style.
 *
 * @typedef {object} Run
 * @property {string} text
 * @property {string} font   family name, e.g. "Arial"
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {number} size   points
 * @property {string} color  "rrggbb"
 */

/**
 * Text that sits on one baseline with no wide gaps, placed as shown: points from the top left.
 *
 * @typedef {object} Segment
 * @property {number} x      where the baseline starts
 * @property {number} y
 * @property {number} angle  degrees, clockwise as shown; 0 reads left to right
 * @property {number} width  along the baseline
 * @property {number} size   the largest font size in it
 * @property {Run[]} runs
 */

/**
 * @typedef {object} PageLayout
 * @property {number} page
 * @property {number} width   points, as shown
 * @property {number} height
 * @property {Segment[]} segments
 * @property {{ png: Uint8Array, width: number, height: number } | null} background
 *   everything but the text, drawn as shown; null when there is nothing to draw
 */

/**
 * @typedef {object} LayoutOptions
 * @property {import('../modify.js').PageSelection} [pages]
 * @property {boolean | 'auto'} [background]  draw what is not text as a picture behind it.
 *   "auto" (the default) does, except on pages whose text is invisible (a scan with a text
 *   layer), where the picture would show every word twice.
 * @property {number} [dpi]  of the background picture, 36 to 300; default 150
 * @property {string} [password]
 */

/**
 * @param {import('../input.js').DocumentInput} input
 * @param {LayoutOptions} options
 * @returns {Promise<{ title: string, author: string, pages: PageLayout[] }>}
 */
export async function readLayout(input, options) {
  const mode = options.background ?? 'auto';
  if (mode !== 'auto' && typeof mode !== 'boolean') fail('INVALID_OPTION', 'background must be true, false or "auto".');
  const dpi = numberIn(options.dpi ?? 150, 'dpi', 36, 300);
  const bytes = await toPdfBytes(input);
  const pdf = await engine();
  const { fn } = pdf;
  return pdf.withDocument(bytes, options, (doc) => {
    /** @param {string} key */
    const meta = (key) => pdf.readUtf16((ptr, length) => fn.FPDF_GetMetaText(doc, key, ptr, length));
    const numbers = selectPages(options.pages, fn.FPDF_GetPageCount(doc));
    if (!numbers.length) fail('INVALID_OPTION', 'No pages were selected.');
    const pages = numbers.map((number) => pdf.withPage(doc, number - 1, (page) => {
      const width = fn.FPDF_GetPageWidthF(page);
      const height = fn.FPDF_GetPageHeightF(page);
      const rotation = unrotate(pdf, page);
      const { segments, invisible } = pdf.withTextPage(page, (textPage) => readSegments(pdf, page, textPage, { width, height }, rotation));
      fn.FPDFPage_SetRotation(page, rotation);
      const wanted = mode === 'auto' ? !invisible : mode;
      return {
        page: number,
        width: round(width),
        height: round(height),
        segments,
        background: wanted ? backgroundOf(pdf, page, width, height, dpi) : null,
      };
    }));
    return { title: meta('Title'), author: meta('Author'), pages };
  });
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} page  with its rotation taken off
 * @param {number} textPage
 * @param {{ width: number, height: number }} shown
 * @param {number} rotation
 * @returns {{ segments: Segment[], invisible: boolean }}
 */
function readSegments(pdf, page, textPage, shown, rotation) {
  const { fn } = pdf;
  const PRECISION = 1000;
  const sizeX = Math.round(shown.width * PRECISION);
  const sizeY = Math.round(shown.height * PRECISION);
  const ptr = pdf.malloc(256);
  /** @param {number} x @param {number} y @returns {[number, number]} */
  const toShown = (x, y) => {
    fn.FPDF_PageToDevice(page, 0, 0, sizeX, sizeY, rotation, x, y, ptr, ptr + 4);
    return [pdf.wasm.getValue(ptr, 'i32') / PRECISION, pdf.wasm.getValue(ptr + 4, 'i32') / PRECISION];
  };
  let glyphs = 0;
  let hidden = 0;
  try {
    /** @param {import('../text.js').Glyph} g */
    const styleOf = (g) => {
      const length = fn.FPDFText_GetFontInfo(textPage, g.index, ptr + 16, 200, ptr + 8);
      const name = length > 1 ? new TextDecoder().decode(pdf.wasm.HEAPU8.subarray(ptr + 16, ptr + 16 + Math.min(length, 200) - 1)) : '';
      const flags = pdf.wasm.getValue(ptr + 8, 'i32');
      const weight = fn.FPDFText_GetFontWeight(textPage, g.index);
      const face = fontFace(name, weight, flags);
      fn.FPDFText_GetFillColor(textPage, g.index, ptr, ptr + 4, ptr + 8, ptr + 12);
      const color = [0, 4, 8].map((o) => (pdf.wasm.getValue(ptr + o, 'i32') & 0xff).toString(16).padStart(2, '0')).join('');
      const mode = fn.FPDFTextObj_GetTextRenderMode(fn.FPDFText_GetTextObject(textPage, g.index));
      return { ...face, size: round(fn.FPDFText_GetFontSize(textPage, g.index)), color, invisible: mode === RENDER_INVISIBLE || mode === RENDER_CLIP };
    };

    /** @type {Segment[]} */
    const segments = [];
    for (const line of layout(pdf, textPage)) {
      /** @type {{ glyphs: import('../text.js').Glyph[], styles: ReturnType<typeof styleOf>[] }[]} */
      const words = line.map((word) => ({ glyphs: word, styles: word.map(styleOf) }));
      for (const w of words) {
        glyphs += w.styles.length;
        hidden += w.styles.filter((s) => s.invisible).length;
      }
      // a wide gap starts a new segment, so columns and table cells keep their places
      /** @type {typeof words[]} */
      const groups = [];
      for (const word of words) {
        const group = groups.at(-1);
        const prev = group?.at(-1);
        if (group && prev) {
          const last = /** @type {import('../text.js').Glyph} */ (prev.glyphs.at(-1));
          const gap = word.glyphs[0].u - (last.u + last.along);
          const size = Math.max(prev.styles.at(-1)?.size ?? 1, 1);
          if (gap <= 1.5 * size) {
            group.push(word);
            continue;
          }
        }
        groups.push([word]);
      }
      for (const group of groups) segments.push(segmentOf(group, toShown));
    }
    return { segments, invisible: glyphs > 0 && hidden / glyphs > 0.8 };
  } finally {
    pdf.free(ptr);
  }
}

/**
 * @param {{ glyphs: import('../text.js').Glyph[], styles: { font: string, bold: boolean, italic: boolean, size: number, color: string }[] }[]} words
 * @param {(x: number, y: number) => [number, number]} toShown
 * @returns {Segment}
 */
function segmentOf(words, toShown) {
  const first = words[0].glyphs[0];
  const [x, y] = toShown(...first.origin);
  // the direction as shown: map a point a little way along the baseline
  const [ax, ay] = toShown(first.origin[0] + Math.cos(first.angle) * 100, first.origin[1] + Math.sin(first.angle) * 100);
  const angle = Math.atan2(ay - y, ax - x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let reach = 0;
  /** @type {Run[]} */
  const runs = [];
  let size = 0;
  words.forEach((word, w) => {
    word.glyphs.forEach((g, i) => {
      const style = word.styles[i];
      size = Math.max(size, style.size);
      for (const [px, py] of [toShown(g.tight[0], g.tight[1]), toShown(g.tight[2], g.tight[3])]) {
        reach = Math.max(reach, (px - x) * dx + (py - y) * dy);
      }
      const text = (w > 0 && i === 0 ? ' ' : '') + g.char;
      const last = runs.at(-1);
      if (last && last.font === style.font && last.bold === style.bold && last.italic === style.italic && last.size === style.size && last.color === style.color) {
        last.text += text;
      } else {
        runs.push({ text, font: style.font, bold: style.bold, italic: style.italic, size: style.size, color: style.color });
      }
    });
  });
  // + 0 turns -0 into 0
  const degrees = ((Math.round(angle * 1800 / Math.PI) / 10 + 360) % 360) + 0;
  return { x: round(x), y: round(y), angle: degrees, width: round(Math.max(reach, 0)), size, runs };
}

/**
 * Everything but the text: text objects are taken out of the page in engine memory (never
 * saved), then the page is drawn with its annotations.
 *
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} page
 * @param {number} width   points, as shown
 * @param {number} height
 * @param {number} dpi
 */
function backgroundOf(pdf, page, width, height, dpi) {
  removeText(pdf, page, false);
  const scale = dpi / 72;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const rgba = drawPage(pdf, page, w, h, FPDF_ANNOT, WHITE);
  let blank = true;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] < 250 || rgba[i + 1] < 250 || rgba[i + 2] < 250) {
      blank = false;
      break;
    }
  }
  return blank ? null : { png: encodePng(rgba, w, h), width: w, height: h };
}

/**
 * @param {import('../engine/pdfium.js').Engine} pdf
 * @param {number} holder  a page, or a form object when `form` is true
 * @param {boolean} form
 */
function removeText(pdf, holder, form) {
  const { fn } = pdf;
  const count = form ? fn.FPDFFormObj_CountObjects(holder) : fn.FPDFPage_CountObjects(holder);
  for (let i = count - 1; i >= 0; i--) {
    const obj = form ? fn.FPDFFormObj_GetObject(holder, i) : fn.FPDFPage_GetObject(holder, i);
    const type = fn.FPDFPageObj_GetType(obj);
    if (type === PAGEOBJ_TEXT) {
      if (form ? fn.FPDFFormObj_RemoveObject(holder, obj) : fn.FPDFPage_RemoveObject(holder, obj)) fn.FPDFPageObj_Destroy(obj);
    } else if (type === PAGEOBJ_FORM) {
      removeText(pdf, obj, true);
    }
  }
}

// Names PDFs use for fonts every office suite has under another name.
const FAMILIES = [
  [/^(Helvetica|Arial|ArialMT|Arimo|LiberationSans|NimbusSans)/i, 'Arial'],
  [/^(Times|TimesNewRoman|Tinos|LiberationSerif|NimbusRom)/i, 'Times New Roman'],
  [/^(Courier|CourierNew|Cousine|LiberationMono|NimbusMono)/i, 'Courier New'],
  [/^(Calibri|Carlito)/i, 'Calibri'],
  [/^(Cambria|Caladea)/i, 'Cambria'],
];

/**
 * The family, weight and slant from a PDF font name like "ABCDEF+Calibri-BoldItalic".
 *
 * @param {string} name
 * @param {number} weight  -1 when PDFium does not know
 * @param {number} flags   the font descriptor flags
 */
export function fontFace(name, weight, flags) {
  const plain = name.replace(/^[A-Z]{6}\+/, '');
  const [base, style = ''] = plain.split(/[-,]/, 2);
  const words = `${base} ${style}`;
  const bold = weight >= 600 || /bold|black|heavy|semibold|demi/i.test(words);
  const italic = (flags & ITALIC_FLAG) !== 0 || /italic|oblique/i.test(words);
  const known = FAMILIES.find(([pattern]) => /** @type {RegExp} */ (pattern).test(base));
  if (known) return { font: /** @type {string} */ (known[1]), bold, italic };
  const family = base
    .replace(/(PSMT|MT|PS)$/, '')
    .replace(/(Bold|Italic|Oblique|Regular)+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return { font: family || 'Arial', bold, italic };
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}
