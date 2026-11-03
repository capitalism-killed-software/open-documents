// A PDF's text in the order a person reads it, grouped into what a word processor holds:
// paragraphs, headings, list items and table rows. Made from readLayout's segments alone, so it
// runs wherever core runs. The Word writer is docx-flow.js.
//
// Nothing is dropped: every segment ends up in exactly one block. Text set at an angle comes
// after the rest of its page.

/** @typedef {import('./layout.js').Segment} Segment */
/** @typedef {import('./layout.js').Run} Run */
/** @typedef {import('./layout.js').PageLayout} PageLayout */

/**
 * Part of a block: a run of styled text, or a line break or a tab between runs.
 *
 * @typedef {Run | { break: true } | { tab: true }} Piece
 */

/**
 * @typedef {object} Block
 * @property {'paragraph' | 'heading' | 'item' | 'row'} kind
 * @property {number} level   1 to 3 for a heading, else 0
 * @property {'left' | 'center' | 'right'} align
 * @property {number} left    where its lines start, in points from the page's left edge; for an
 *   item, where the text after the marker starts
 * @property {number} first   where its first line starts (an item's marker)
 * @property {number[]} tabs  for a row, where each cell after the first starts
 * @property {number | null} origin  the left edge of the column it was set in, which its
 *   indents count from; null when it was set across the page
 * @property {number} before  points of space above it
 * @property {number} size    its largest font size
 * @property {Piece[]} pieces
 */

/**
 * @typedef {object} FlowPage
 * @property {number} page
 * @property {number} width   points, as shown
 * @property {number} height
 * @property {{ top: number, right: number, bottom: number, left: number } | null} margins
 *   from the page's edges to its text, null when it has none
 * @property {Block[]} blocks
 */

/**
 * The style most of the text is set in.
 *
 * @typedef {object} Body
 * @property {number} size
 * @property {string} font
 * @property {import('./layout.js').FontKind} kind
 * @property {string} color
 */

/**
 * The part of a page a line belongs to: the whole page, or one column. `measure` is the right
 * edge a full line reaches.
 *
 * @typedef {{ left: number, right: number, measure: number, column: boolean }} Region
 */

/**
 * @typedef {object} Draft
 * @property {'paragraph' | 'item' | 'row'} kind
 * @property {Region} region
 * @property {Segment[]} lines
 * @property {Piece[]} pieces
 * @property {number} first
 * @property {number} left
 * @property {number | undefined} [text]  an item's continuation lines start here
 */

// A list marker at the start of a line, and the space after it.
const MARKER = /^([•◦▪▫‣⁃∙·●○■□–—*-]|\d{1,3}[.)]|[a-z][.)]|[A-Z]\)|\((?:\d{1,3}|[a-z]|[ivxlc]+)\))(\s+)/;

/**
 * @param {PageLayout[]} pages
 * @returns {{ body: Body | null, pages: FlowPage[] }}  body is null when there is no text at all
 */
export function flowBlocks(pages) {
  const body = bodyOf(pages);
  const size = body?.size ?? 12;
  const drafted = pages.map((page) => {
    const segments = page.segments.filter((s) => textOf(s).trim());
    const flat = segments.filter((s) => s.angle === 0);
    const turned = segments.filter((s) => s.angle !== 0);
    const left = Math.min(...segments.map((s) => s.x));
    /** @type {Region} */
    const edge = { left, right: page.width - left, measure: page.width - left, column: false };
    const drafts = [
      ...draftsOf(order(flat, size, page.width, false)),
      ...turned.map((s) => /** @type {Draft} */ ({ kind: 'paragraph', region: edge, lines: [s], pieces: s.runs.map((r) => ({ ...r })), first: left, left })),
    ];
    return { page, segments, drafts };
  });

  // heading levels: the sizes headings are set in, largest first
  const big = drafted.flatMap(({ drafts }) => drafts.filter((d) => headingKind(d, size) === 'big').map((d) => half(sizeOf(d))));
  const levels = [...new Set(big)].sort((a, b) => b - a);

  return {
    body,
    pages: drafted.map(({ page, segments, drafts }) => {
      let above = -Infinity;
      const blocks = drafts.map((draft) => {
        const block = finish(draft, size, levels, above);
        if (draft.lines[0].angle === 0) above = Math.max(above, /** @type {Segment} */ (draft.lines.at(-1)).y);
        return block;
      });
      return { page: page.page, width: page.width, height: page.height, margins: marginsOf(segments, page), blocks };
    }),
  };
}

/**
 * @param {Draft} draft
 * @param {number} body  the body size
 * @param {number[]} levels
 * @param {number} above  the baseline of the block above, from the top
 * @returns {Block}
 */
function finish(draft, body, levels, above) {
  const size = sizeOf(draft);
  const heading = headingKind(draft, body);
  const kind = heading ? 'heading' : draft.kind;
  const level = heading === 'big' ? Math.min(levels.indexOf(half(size)) + 1, 3) : heading ? Math.min(levels.length + 1, 3) : 0;
  const first = draft.lines[0];
  // the first block of a page has nothing above it to measure from
  const before = above === -Infinity ? 0 : Math.min(36, Math.max(0, half(first.y - above - 1.2 * size)));
  const pieces = merge(draft.kind === 'item' ? markerTab(draft.pieces) : draft.pieces);
  return {
    kind,
    level,
    align: draft.kind === 'row' ? 'left' : alignOf(draft),
    left: draft.kind === 'item' ? (draft.text ?? draft.first + 18) : draft.left,
    first: draft.first,
    tabs: draft.kind === 'row' ? draft.lines.slice(1).map((s) => s.x) : [],
    origin: draft.region.column ? draft.region.left : null,
    before,
    size,
    pieces,
  };
}

/**
 * Lines in reading order: top to bottom, except where the page is set in two columns, which are
 * read one after the other. Columns are found where a run of lines leaves a clear vertical gap
 * and both sides hold lines that fill their width; short cells sharing baselines are a table and
 * stay as rows.
 *
 * @param {Segment[]} segments  all at angle 0
 * @param {number} body
 * @param {number} width  of the page
 * @param {boolean} column  these segments are one column of a page
 * @returns {{ segments: Segment[], region: Region }[]}
 */
function order(segments, body, width, column) {
  if (!segments.length) return [];
  const left = Math.min(...segments.map((s) => s.x));
  const right = Math.max(...segments.map(end));
  // short lines alone on a page are measured against a margin like the left one, so that the
  // longest of them does not count as full
  const measure = !column && right - left < 0.5 * (width - 2 * left) ? width - left : right;
  /** @type {Region} */
  const region = { left, right, measure, column };
  const bands = bandsOf(rowsOf(segments));
  /** @type {{ segments: Segment[], region: Region }[]} */
  const lines = [];
  for (let i = 0; i < bands.length;) {
    const split = columnsFrom(bands, i, body);
    if (split) {
      const inside = bands.slice(i, split.end).flatMap((b) => b.segments);
      const mid = (split.gutter.from + split.gutter.to) / 2;
      lines.push(...order(inside.filter((s) => end(s) <= mid), body, width, true), ...order(inside.filter((s) => s.x >= mid), body, width, true));
      i = split.end;
    } else {
      for (const row of bands[i].rows) lines.push({ segments: row, region });
      i++;
    }
  }
  return lines;
}

/**
 * Segments on one baseline, left to right; rows top to bottom.
 *
 * @param {Segment[]} segments
 */
function rowsOf(segments) {
  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x - b.x);
  /** @type {Segment[][]} */
  const rows = [];
  for (const s of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(s.y - row[0].y) <= 0.35 * Math.min(s.size, row[0].size)) row.push(s);
    else rows.push([s]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Rows whose letters overlap from top to bottom.
 *
 * @param {Segment[][]} rows
 */
function bandsOf(rows) {
  /** @type {{ rows: Segment[][], segments: Segment[], bottom: number }[]} */
  const bands = [];
  for (const row of rows) {
    const top = Math.min(...row.map((s) => s.y - 0.7 * s.size));
    const bottom = Math.max(...row.map((s) => s.y + 0.2 * s.size));
    const band = bands.at(-1);
    if (band && top < band.bottom) {
      band.rows.push(row);
      band.segments.push(...row);
      band.bottom = Math.max(band.bottom, bottom);
    } else {
      bands.push({ rows: [row], segments: [...row], bottom });
    }
  }
  return bands;
}

/**
 * The longest run of bands from `i` that reads as two columns, if there is one.
 *
 * @param {{ rows: Segment[][], segments: Segment[] }[]} bands
 * @param {number} i
 * @param {number} body
 */
function columnsFrom(bands, i, body) {
  if (headingLike(bands[i].segments, body)) return null;
  /** @type {Segment[]} */
  const segments = [];
  /** @type {{ end: number, gutter: { from: number, to: number } } | null} */
  let best = null;
  for (let j = i; j < bands.length; j++) {
    if (j > i && headingLike(bands[j].segments, body)) break;
    segments.push(...bands[j].segments);
    const gutter = gutterOf(segments, Math.max(body, 8));
    if (!gutter) {
      if (j > i) break;
      continue;
    }
    // a line of a column is one segment; two on one side of the gutter are table cells
    const mid = (gutter.from + gutter.to) / 2;
    const cells = bands.slice(i, j + 1).some((b) => b.rows.some((row) => row.filter((s) => end(s) <= mid).length > 1 || row.filter((s) => s.x >= mid).length > 1));
    if (cells) break;
    if (twoColumns(segments, gutter, body)) best = { end: j + 1, gutter };
  }
  return best;
}

/**
 * The widest gap from left to right that no segment crosses, at least `least` wide.
 *
 * @param {Segment[]} segments
 * @param {number} least
 */
function gutterOf(segments, least) {
  const spans = segments.map((s) => [s.x, end(s)]).sort((a, b) => a[0] - b[0]);
  let reach = spans[0][1];
  /** @type {{ from: number, to: number } | null} */
  let best = null;
  for (const [from, to] of spans.slice(1)) {
    if (from - reach >= least && (!best || from - reach > best.to - best.from)) best = { from: reach, to: from };
    reach = Math.max(reach, to);
  }
  return best;
}

/**
 * Both sides of the gutter hold at least two lines, are wide, and are mostly filled: column
 * text, not table cells.
 *
 * @param {Segment[]} segments
 * @param {{ from: number, to: number }} gutter
 * @param {number} body
 */
function twoColumns(segments, gutter, body) {
  const mid = (gutter.from + gutter.to) / 2;
  const total = Math.max(...segments.map(end)) - Math.min(...segments.map((s) => s.x));
  return [segments.filter((s) => end(s) <= mid), segments.filter((s) => s.x >= mid)].every((side) => {
    if (side.length < 2) return false;
    const width = Math.max(...side.map(end)) - Math.min(...side.map((s) => s.x));
    if (width < Math.max(0.2 * total, 8 * body)) return false;
    const filled = side.filter((s) => s.width >= 0.6 * width).length;
    // a paragraph's last line is often short
    return filled >= Math.max(2, Math.ceil(((side.length - 1) * 2) / 3));
  });
}

/**
 * Larger than the body, or a single line all in bold.
 *
 * @param {Segment[]} segments
 * @param {number} body
 */
function headingLike(segments, body) {
  return segments.every((s) => s.size >= body * 1.15) || (segments.length === 1 && allBold(segments[0]));
}

/**
 * Lines grouped into paragraphs, list items and table rows.
 *
 * @param {{ segments: Segment[], region: Region }[]} lines
 * @returns {Draft[]}
 */
function draftsOf(lines) {
  /** @type {Draft[]} */
  const drafts = [];
  /** @type {Draft | null} */
  let current = null;
  for (const { segments, region } of lines) {
    if (segments.length > 1) {
      // cells on one baseline: one paragraph, a tab before each cell after the first
      /** @type {Piece[]} */
      const pieces = [];
      segments.forEach((s, i) => {
        if (i) pieces.push({ tab: true });
        pieces.push(...s.runs.map((r) => ({ ...r })));
      });
      drafts.push({ kind: 'row', region, lines: segments, pieces, first: segments[0].x, left: segments[0].x });
      current = null;
      continue;
    }
    const [s] = segments;
    const marker = MARKER.test(textOf(s));
    if (current && !marker && joins(current, s, region)) {
      extend(current, s, region);
      continue;
    }
    current = { kind: marker ? 'item' : 'paragraph', region, lines: [s], pieces: s.runs.map((r) => ({ ...r })), first: s.x, left: s.x };
    drafts.push(current);
  }
  // items of one list share where their text starts, known from any item that wraps
  drafts.forEach((draft, i) => {
    if (draft.kind !== 'item' || draft.text !== undefined) return;
    /** @param {Draft | undefined} d */
    const same = (d) => d?.kind === 'item' && Math.abs(d.first - draft.first) < 1 && d.region === draft.region;
    /** @param {Draft} upper @param {Draft} lower */
    const close = (upper, lower) => lower.lines[0].y - /** @type {Segment} */ (upper.lines.at(-1)).y <= 1.8 * lower.lines[0].size;
    for (const step of [-1, 1]) {
      for (let j = i + step; same(drafts[j]) && close(drafts[Math.min(j, j - step)], drafts[Math.max(j, j - step)]); j += step) {
        if (drafts[j].text !== undefined) {
          draft.text = drafts[j].text;
          return;
        }
      }
    }
  });
  return drafts;
}

/**
 * Does the line go on with the paragraph or item above it?
 *
 * @param {Draft} draft
 * @param {Segment} s
 * @param {Region} region
 */
function joins(draft, s, region) {
  if (draft.kind === 'row' || draft.region !== region) return false;
  const prev = /** @type {Segment} */ (draft.lines.at(-1));
  if (Math.abs(s.size - prev.size) > 0.5) return false;
  const step = s.y - prev.y;
  if (step < 0.5 * s.size || step > 1.8 * s.size) return false;
  const full = isFull(prev, s, region);
  // a short line all in bold (a label) does not run into plain text below it
  if (allBold(prev) !== allBold(s) && !full) return false;
  /** @param {number} a @param {number} b */
  const near = (a, b) => Math.abs(a - b) <= 0.6 * s.size;
  if (draft.kind === 'item') {
    if (draft.text !== undefined) return near(s.x, draft.text);
    return (s.x > draft.first + 0.3 * s.size && s.x <= draft.first + 4 * s.size) || (near(s.x, draft.first) && full);
  }
  // a first line set in from the rest
  if (draft.lines.length === 1 && s.x < draft.first - 0.6 * s.size && draft.first - s.x <= 4 * s.size) return full;
  return near(s.x, draft.left);
}

/**
 * Add a line to a paragraph or item: after a space when the line above was full, so the break
 * was the writer's wrapping; straight after a hyphen that ends a line; otherwise after a line
 * break, which keeps short stacked lines (an address) as they were.
 *
 * @param {Draft} draft
 * @param {Segment} s
 * @param {Region} region
 */
function extend(draft, s, region) {
  const prev = /** @type {Segment} */ (draft.lines.at(-1));
  const last = /** @type {Run} */ (draft.pieces.findLast((p) => 'text' in p));
  if (/\p{L}-$/u.test(textOf(prev))) {
    // a word broken in two loses its hyphen; a compound ("Jean-" then "Paul") keeps it
    if (/^\p{Ll}/u.test(textOf(s))) last.text = last.text.slice(0, -1);
  } else if (isFull(prev, s, region)) {
    last.text += ' ';
  } else {
    draft.pieces.push({ break: true });
  }
  draft.pieces.push(...s.runs.map((r) => ({ ...r })));
  draft.lines.push(s);
  if (draft.kind === 'item') {
    if (draft.text === undefined && s.x > draft.first + 0.3 * s.size) draft.text = s.x;
  } else if (draft.lines.length === 2) {
    draft.left = s.x;
  }
}

/**
 * Was the line above full: would the next line's first word have fitted on it? Word widths
 * are estimated from the segment's width, by characters.
 *
 * @param {Segment} prev
 * @param {Segment} s
 * @param {Region} region
 */
function isFull(prev, s, region) {
  const text = textOf(s).trimStart();
  const word = text.split(/\s/)[0];
  const width = (s.width * word.length) / Math.max(1, text.length);
  return end(prev) + 0.25 * s.size + width > region.measure - 0.5 * s.size;
}

/**
 * @param {Draft} draft
 * @returns {'big' | 'bold' | null}
 */
function headingKind(draft, body) {
  if (draft.kind !== 'paragraph' || draft.lines.length > 2) return null;
  const text = draft.lines.map(textOf).join(' ').trim();
  if (text.length > 200) return null;
  if (sizeOf(draft) >= body * 1.15) return 'big';
  if (draft.lines.length === 1 && allBold(draft.lines[0]) && text.length <= 80 && !text.endsWith('.')) return 'bold';
  return null;
}

/**
 * @param {Draft} draft
 * @returns {'left' | 'center' | 'right'}
 */
function alignOf(draft) {
  const { left, measure } = draft.region;
  const middle = (left + measure) / 2;
  const inset = draft.lines.every((s) => s.x - left > 2 * s.size);
  if (!inset) return 'left';
  if (draft.lines.every((s) => Math.abs(s.x + s.width / 2 - middle) <= Math.max(s.size, 0.02 * (measure - left)))) return 'center';
  if (draft.lines.every((s) => Math.abs(end(s) - measure) <= 0.5 * s.size)) return 'right';
  return 'left';
}

/**
 * An item's marker, then a tab where the space after it was, so the text lines up with the
 * lines below it.
 *
 * @param {Piece[]} pieces
 */
function markerTab(pieces) {
  const first = /** @type {Run} */ (pieces[0]);
  const match = MARKER.exec(first.text);
  // the marker in a run of its own, with the rest of the line after it
  if (!match) return pieces;
  const marker = { ...first, text: match[1] };
  const rest = { ...first, text: first.text.slice(match[0].length) };
  return [marker, { tab: true }, ...(rest.text ? [rest] : []), ...pieces.slice(1)];
}

/**
 * Neighbouring runs in one style become one.
 *
 * @param {Piece[]} pieces
 */
function merge(pieces) {
  /** @type {Piece[]} */
  const out = [];
  for (const piece of pieces) {
    const last = out.at(-1);
    if ('text' in piece && last && 'text' in last && sameStyle(last, piece)) last.text += piece.text;
    else if (!('text' in piece) || piece.text) out.push(piece);
  }
  return out;
}

/**
 * @param {Run} a
 * @param {Run} b
 */
function sameStyle(a, b) {
  return a.font === b.font && a.bold === b.bold && a.italic === b.italic && a.size === b.size && a.color === b.color;
}

/**
 * The size, font and colour most characters are set in.
 *
 * @param {PageLayout[]} pages
 * @returns {Body | null}
 */
function bodyOf(pages) {
  const runs = pages.flatMap((p) => p.segments.flatMap((s) => s.runs)).filter((r) => r.text.trim());
  if (!runs.length) return null;
  /** @template T @param {T[]} keys @param {number[]} weights */
  const most = (keys, weights) => {
    /** @type {Map<T, number>} */
    const counts = new Map();
    keys.forEach((k, i) => counts.set(k, (counts.get(k) ?? 0) + weights[i]));
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  };
  const size = most(runs.map((r) => half(r.size)), runs.map((r) => r.text.length));
  const body = runs.filter((r) => half(r.size) === size);
  const weights = body.map((r) => r.text.length);
  const font = most(body.map((r) => r.font), weights);
  const kind = /** @type {Run} */ (body.find((r) => r.font === font)).kind;
  return { size, font, kind, color: most(body.map((r) => r.color), weights) };
}

/**
 * @param {Segment[]} segments
 * @param {PageLayout} page
 */
function marginsOf(segments, page) {
  if (!segments.length) return null;
  return {
    top: Math.max(0, Math.min(...segments.map((s) => s.y - s.size))),
    right: Math.max(0, page.width - Math.max(...segments.map(end))),
    bottom: Math.max(0, page.height - Math.max(...segments.map((s) => s.y + 0.3 * s.size))),
    left: Math.max(0, Math.min(...segments.map((s) => s.x))),
  };
}

/** @param {Segment} s */
function textOf(s) {
  return s.runs.map((r) => r.text).join('');
}

/** @param {Segment} s */
function end(s) {
  return s.x + s.width;
}

/** @param {Segment} s */
function allBold(s) {
  return s.runs.every((r) => r.bold || !r.text.trim());
}

/** @param {Draft} draft */
function sizeOf(draft) {
  return Math.max(...draft.lines.map((s) => s.size));
}

/** @param {number} n */
function half(n) {
  return Math.round(n * 2) / 2;
}
