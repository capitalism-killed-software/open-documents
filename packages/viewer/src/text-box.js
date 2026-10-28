// Growing a text box (a FreeText annotation) to hold what was typed into it. A click with the
// Text tool makes a box one line high, and both the page and the saved file show only the part
// of the text that fits in the box.

// How far apart PDFium's appearance sets lines, as a share of the font size, with room to spare.
const LINE = 1.25;
// Points kept free around the text.
const PAD = 4;

/**
 * The rectangle a text box needs to show all of its text, or null when it already does. Boxes
 * only grow, so one sized by hand keeps at least that size: wider first, up to the page's right
 * edge, then taller, up to its bottom.
 *
 * @param {{ contents?: string, fontSize?: number, rect: { origin: { x: number, y: number }, size: { width: number, height: number } } }} box
 * @param {{ width: number, height: number }} page  points
 * @param {(text: string) => number} measure  how wide a line of the box's text is, in points
 * @returns {{ origin: { x: number, y: number }, size: { width: number, height: number } } | null}
 */
export function fitTextBox(box, page, measure) {
  const { origin, size } = box.rect;
  const fontSize = box.fontSize ?? 12;
  const paragraphs = String(box.contents ?? '').split(/\r?\n/);
  const longest = Math.max(0, ...paragraphs.map((p) => measure(p)));
  const width = Math.max(size.width, Math.min(longest + PAD, page.width - origin.x));
  const lines = paragraphs.reduce((n, p) => n + linesOf(p, width - PAD, measure), 0);
  const height = Math.max(size.height, Math.min(lines * fontSize * LINE + PAD, page.height - origin.y));
  if (width - size.width < 0.5 && height - size.height < 0.5) return null;
  return { origin: { x: origin.x, y: origin.y }, size: { width: round(width), height: round(height) } };
}

/**
 * How many lines a paragraph takes, breaking between words.
 *
 * @param {string} text
 * @param {number} width
 * @param {(text: string) => number} measure
 */
function linesOf(text, width, measure) {
  let lines = 1;
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines += 1;
      line = word;
    } else {
      line = next;
    }
  }
  return lines;
}

/** @param {number} n */
function round(n) {
  return Math.round(n * 100) / 100;
}
