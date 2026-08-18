import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import * as od from '@open-documents/core';
import { createConverter } from '@open-documents/node';

const USAGE = `opendocs: inspect, render and change PDF files

Convert to PDF (Word, Excel, PowerPoint, OpenDocument, RTF, CSV, text, HTML, Markdown,
email, JPEG, PNG, TIFF; needs LibreOffice for office files and Chromium for web pages):
  opendocs convert <file> [-o out.pdf] [--paper letter|a4|legal|a3|a5] [--landscape] [--javascript] [--pdfa 2]
  opendocs convert --url https://example.com -o page.pdf [--allow-host intranet.local]

Out of PDF (keeps each page's layout: text boxes for the text, a picture for the rest):
  opendocs to-docx <file.pdf> [-o out.docx] [--pages ...] [--no-background]
  opendocs to-pptx <file.pdf> [-o out.pptx] [--pages ...] [--no-background]

Structure (headings, lists, tables, reading order; needs the Docling worker, see docs/api.md):
  opendocs to-markdown <file.pdf> [-o out.md] [--pages ...]     prints it without -o
  opendocs to-html <file.pdf> [-o out.html] [--pages ...]
  opendocs to-json <file.pdf> [-o out.json] [--pages ...]
  opendocs to-xlsx <file.pdf> [-o tables.xlsx] [--pages ...]    one sheet per table

Look:
  opendocs info <file.pdf> [--json]
  opendocs text <file.pdf> [--pages 1-3,5]
  opendocs render <file.pdf> [--page N | --pages 1-3] [--dpi N | --width PX] [-o out.png]

PDF/A (the archive form of PDF):
  opendocs pdfa <file.pdf> [--part 2]            add what PDF/A needs, then say what is still missing
  opendocs pdfa <file.pdf> --check [--part 2]    only say what is missing

Compare two versions:
  opendocs compare <before.pdf> <after.pdf> [--json] [--exact] [-o report.pdf]
                                   list what changed; -o writes a side-by-side report

Pages (each writes a new file; -o names it):
  opendocs merge <a.pdf> <b.pdf> ... -o out.pdf
  opendocs split <file.pdf> [--every N | --ranges "1-3;4-last" | --at 4,9] [-o folder]
  opendocs extract <file.pdf> --pages 1-3,5
  opendocs remove <file.pdf> --pages 2,4
  opendocs reorder <file.pdf> --order 3,1,2
  opendocs rotate <file.pdf> --angle 90 [--pages ...]      (anticlockwise: --angle=-90)
  opendocs slice <file.pdf> [--columns 2] [--rows 1] [--pages ...]
  opendocs crop <file.pdf> --margins 36 | --margins top,right,bottom,left [--pages ...]
  opendocs nup <file.pdf> [--columns 2] [--rows 1]
  opendocs blank <file.pdf> --at N [--count N]

Smaller files (compress, linearize and repair need qpdf):
  opendocs compress <file.pdf>     smaller, losing nothing
  opendocs compress-images <file.pdf> [--dpi 150] [--quality 75]
                                   scans and photos scaled down (works without qpdf)
  opendocs linearize <file.pdf>    fast web view
  opendocs repair <file.pdf>       rebuild a damaged file

OCR (English comes with it; for others, npm install @tesseract.js-data/<code>):
  opendocs ocr <file.pdf> [--lang eng+deu] [--pages ...] [--dpi 300] [--force]
                                   make scanned pages searchable
  opendocs ocr <file.pdf> --json   print the words read, with positions, instead

Edit (each writes a new file; -o names it):
  opendocs stamp <file.pdf> --text "..." [--position top-right | --at x,y] [--size N]
  opendocs watermark <file.pdf> --text DRAFT [--color #ff0000] [--opacity 0.25] [--angle 45] [--behind]
  opendocs numbers <file.pdf> [--format "Page {n} of {total}"] [--start N] [--position bottom-center]
  opendocs header-footer <file.pdf> [--header "left|center|right"] [--footer "left|center|right"]
  opendocs bates <file.pdf> [--prefix ACME-] [--start N] [--digits 6]
  opendocs meta <file.pdf> [--title ...] [--author ...] [--subject ...] [--keywords ...]
  opendocs overlay <file.pdf> --layer letterhead.pdf [--behind] [--fit contain|stretch] [--pages ...]
  opendocs fields <file.pdf> [--json]              list form fields and their values
  opendocs fill <file.pdf> --values values.json [--flatten]   fill fields by name
  opendocs add-fields <file.pdf> --fields fields.json        add new fields
  opendocs flatten <file.pdf> [--pages ...]        fields and annotations become part of the page
  opendocs bookmarks <file.pdf> [--json]
  opendocs encrypt <file.pdf> [--user-password pw] [--owner-password pw] [--no-print] [--no-copy] [--no-modify]
  opendocs decrypt <file.pdf> --password pw
  opendocs images <a.jpg> <b.png> ... -o out.pdf [--page-size letter|a4|legal|fit] [--margin N]

Text options for stamp, watermark, numbers, header-footer and bates:
  --size N  --color #rrggbb  --opacity 0..1  --font Helvetica-Bold  --pages ...

Options:
  --password <pw>   for encrypted files
  -o, --output      where to write
  -h, --help        show this

Page lists look like 1-3,5,8-last. "odd", "even" and "all" work too.
`;

/**
 * @typedef {object} Io
 * @property {(s: string) => void} out
 * @property {(s: string) => void} err
 */

/** @type {Record<string, import('node:util').ParseArgsOptionDescriptor>} */
const OPTIONS = {
  json: { type: 'boolean' },
  page: { type: 'string' },
  pages: { type: 'string' },
  dpi: { type: 'string' },
  width: { type: 'string' },
  output: { type: 'string', short: 'o' },
  password: { type: 'string' },
  every: { type: 'string' },
  ranges: { type: 'string' },
  at: { type: 'string' },
  order: { type: 'string' },
  angle: { type: 'string' },
  columns: { type: 'string' },
  rows: { type: 'string' },
  margins: { type: 'string' },
  count: { type: 'string' },
  text: { type: 'string' },
  color: { type: 'string' },
  opacity: { type: 'string' },
  size: { type: 'string' },
  font: { type: 'string' },
  position: { type: 'string' },
  behind: { type: 'boolean' },
  format: { type: 'string' },
  start: { type: 'string' },
  prefix: { type: 'string' },
  digits: { type: 'string' },
  header: { type: 'string' },
  footer: { type: 'string' },
  title: { type: 'string' },
  author: { type: 'string' },
  subject: { type: 'string' },
  keywords: { type: 'string' },
  'user-password': { type: 'string' },
  'owner-password': { type: 'string' },
  'no-print': { type: 'boolean' },
  'no-copy': { type: 'boolean' },
  'no-modify': { type: 'boolean' },
  'no-annotate': { type: 'boolean' },
  'page-size': { type: 'string' },
  margin: { type: 'string' },
  url: { type: 'string' },
  'allow-host': { type: 'string', multiple: true },
  paper: { type: 'string' },
  landscape: { type: 'boolean' },
  javascript: { type: 'boolean' },
  layer: { type: 'string' },
  'no-background': { type: 'boolean' },
  exact: { type: 'boolean' },
  quality: { type: 'string' },
  pdfa: { type: 'string' },
  part: { type: 'string' },
  check: { type: 'boolean' },
  'password-b': { type: 'string' },
  values: { type: 'string' },
  fields: { type: 'string' },
  flatten: { type: 'boolean' },
  fit: { type: 'string' },
  lang: { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

/**
 * @typedef {object} Context
 * @property {string[]} files
 * @property {Record<string, any>} values
 * @property {Io} io
 * @property {string} command
 */

/** @type {Record<string, { files: 'one' | 'many' | 'convert', run: (ctx: Context) => Promise<void> }>} */
const COMMANDS = {
  convert: { files: 'convert', run: convert },
  info: { files: 'one', run: info },
  text: { files: 'one', run: text },
  render: { files: 'one', run: render },
  merge: { files: 'many', run: merge },
  compare: { files: 'many', run: compare },
  pdfa: { files: 'one', run: pdfa },
  split: { files: 'one', run: split },
  extract: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.extractPages(bytes, required(ctx, 'pages'), pw)) },
  remove: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.removePages(bytes, required(ctx, 'pages'), pw)) },
  reorder: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.reorder(bytes, required(ctx, 'order'), pw)) },
  rotate: {
    files: 'one',
    run: (ctx) => change(ctx, async (bytes, pw) => od.rotate(bytes, { ...pw, angle: integer(required(ctx, 'angle'), '--angle'), pages: ctx.values.pages })),
  },
  slice: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.slicePages(bytes, { ...pw, ...grid(ctx), pages: ctx.values.pages })) },
  crop: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.crop(bytes, { ...pw, margins: margins(required(ctx, 'margins')), pages: ctx.values.pages })) },
  nup: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.nUp(bytes, { ...pw, ...grid(ctx) })) },
  blank: {
    files: 'one',
    run: (ctx) =>
      change(ctx, async (bytes, pw) =>
        od.insertBlankPages(bytes, {
          ...pw,
          at: integer(required(ctx, 'at'), '--at'),
          count: ctx.values.count === undefined ? undefined : integer(ctx.values.count, '--count'),
        }),
      ),
  },
  stamp: {
    files: 'one',
    run: (ctx) => {
      const at = ctx.values.at === undefined ? undefined : point(ctx.values.at);
      return change(ctx, async (bytes, pw) => od.addText(bytes, { ...pw, ...style(ctx), text: required(ctx, 'text'), at, position: ctx.values.position }));
    },
  },
  watermark: {
    files: 'one',
    run: (ctx) =>
      change(ctx, async (bytes, pw) =>
        od.watermark(bytes, {
          ...pw,
          ...style(ctx),
          text: required(ctx, 'text'),
          angle: ctx.values.angle === undefined ? undefined : number(ctx.values.angle, '--angle', true),
          position: ctx.values.position,
          behind: ctx.values.behind,
        }),
      ),
  },
  numbers: {
    files: 'one',
    run: (ctx) =>
      change(ctx, async (bytes, pw) =>
        od.pageNumbers(bytes, { ...pw, ...style(ctx), format: ctx.values.format, start: optionalInteger(ctx, 'start'), position: ctx.values.position }),
      ),
  },
  'header-footer': {
    files: 'one',
    run: (ctx) =>
      change(ctx, async (bytes, pw) =>
        od.headerFooter(bytes, { ...pw, ...style(ctx), header: band(ctx.values.header), footer: band(ctx.values.footer), start: optionalInteger(ctx, 'start'), title: ctx.values.title }),
      ),
  },
  bates: {
    files: 'one',
    run: (ctx) =>
      change(ctx, async (bytes, pw) =>
        od.bates(bytes, { ...pw, ...style(ctx), prefix: ctx.values.prefix, start: optionalInteger(ctx, 'start'), digits: optionalInteger(ctx, 'digits'), position: ctx.values.position }),
      ),
  },
  meta: {
    files: 'one',
    run: (ctx) => {
      const fields = Object.fromEntries(['title', 'author', 'subject', 'keywords'].filter((k) => ctx.values[k] !== undefined).map((k) => [k, ctx.values[k]]));
      if (!Object.keys(fields).length) throw new od.OpenDocumentsError('INVALID_OPTION', 'opendocs meta needs --title, --author, --subject or --keywords. Use opendocs info to read them.');
      return change(ctx, async (bytes, pw) => od.setMetadata(bytes, { ...pw, ...fields }));
    },
  },
  overlay: {
    files: 'one',
    run: async (ctx) => {
      const layer = await readFile(required(ctx, 'layer'));
      return change(ctx, (bytes, pw) => od.overlay(bytes, layer, { ...pw, pages: ctx.values.pages, fit: ctx.values.fit, behind: ctx.values.behind }));
    },
  },
  ocr: { files: 'one', run: ocr },
  fields: { files: 'one', run: fields },
  fill: {
    files: 'one',
    run: async (ctx) => {
      const values = await jsonFile(ctx, 'values');
      return change(ctx, (bytes, pw) => od.fillForm(bytes, values, { ...pw, flatten: ctx.values.flatten }));
    },
  },
  'add-fields': {
    files: 'one',
    run: async (ctx) => {
      const list = await jsonFile(ctx, 'fields');
      return change(ctx, (bytes, pw) => od.addFormFields(bytes, list, pw));
    },
  },
  flatten: { files: 'one', run: (ctx) => change(ctx, (bytes, pw) => od.flatten(bytes, { ...pw, pages: ctx.values.pages })) },
  'to-docx': { files: 'one', run: (ctx) => office(ctx, 'docx') },
  'to-pptx': { files: 'one', run: (ctx) => office(ctx, 'pptx') },
  'to-markdown': { files: 'one', run: (ctx) => structure(ctx, 'markdown') },
  'to-html': { files: 'one', run: (ctx) => structure(ctx, 'html') },
  'to-json': { files: 'one', run: (ctx) => structure(ctx, 'json') },
  'to-xlsx': { files: 'one', run: (ctx) => structure(ctx, 'xlsx') },
  bookmarks: { files: 'one', run: bookmarks },
  encrypt: {
    files: 'one',
    run: (ctx) => {
      const v = ctx.values;
      /** @type {import('@open-documents/core').Permissions} */
      const permissions = {};
      if (v['no-print']) permissions.print = false;
      if (v['no-copy']) permissions.copy = false;
      if (v['no-modify']) permissions.modify = false;
      if (v['no-annotate']) permissions.annotate = false;
      return change(ctx, async (bytes, pw) =>
        od.encrypt(bytes, {
          ...pw,
          userPassword: v['user-password'],
          ownerPassword: v['owner-password'],
          permissions: Object.keys(permissions).length ? permissions : undefined,
        }),
      );
    },
  },
  decrypt: { files: 'one', run: (ctx) => change(ctx, async (bytes, pw) => od.decrypt(bytes, pw)) },
  'compress-images': {
    files: 'one',
    run: (ctx) => change(ctx, (bytes, pw) => od.compressImages(bytes, {
      ...pw,
      dpi: ctx.values.dpi === undefined ? undefined : integer(ctx.values.dpi, '--dpi'),
      quality: ctx.values.quality === undefined ? undefined : integer(ctx.values.quality, '--quality'),
    })),
  },
  compress: { files: 'one', run: (ctx) => withConverter((c) => change(ctx, (bytes, pw) => c.compress(bytes, pw))) },
  linearize: { files: 'one', run: (ctx) => withConverter((c) => change(ctx, (bytes, pw) => c.linearize(bytes, pw))) },
  repair: { files: 'one', run: (ctx) => withConverter((c) => change(ctx, (bytes, pw) => c.repair(bytes, pw))) },
  images: { files: 'many', run: images },
};

/**
 * @param {string[]} argv  arguments after the program name
 * @param {Io} io
 * @returns {Promise<number>} exit code
 */
export async function main(argv, io) {
  /** @type {ReturnType<typeof parseArgs>} */
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    io.err(`${/** @type {Error} */ (err).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...files] = positionals;
  if (values.help || !command) {
    io.out(USAGE);
    return values.help ? 0 : 2;
  }
  const spec = COMMANDS[command];
  if (!spec) {
    io.err(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
  }
  if (spec.files === 'convert') {
    if ((files.length === 1) === Boolean(values.url) || files.length > 1) {
      io.err('opendocs convert needs one file, or --url and no file.\n');
      return 2;
    }
  } else if (files.length === 0 || (spec.files === 'one' && files.length > 1) || (command === 'merge' && files.length < 2) || (command === 'compare' && files.length !== 2)) {
    io.err(
      command === 'merge' ? 'opendocs merge needs two or more PDF files.\n'
        : command === 'compare' ? 'opendocs compare needs two PDF files: the first version, then the second.\n'
        : command === 'images' ? 'opendocs images needs one or more JPEG or PNG files.\n'
          : `opendocs ${command} needs one PDF file.\n`,
    );
    return 2;
  }

  try {
    await spec.run({ files, values: /** @type {Record<string, any>} */ (values), io, command });
    return 0;
  } catch (err) {
    if (err instanceof od.OpenDocumentsError) {
      io.err(`error: ${err.message}\n`);
      return 1;
    }
    const e = /** @type {NodeJS.ErrnoException} */ (err);
    if (e.code === 'ENOENT') {
      io.err(`error: no such file: ${e.path}\n`);
      return 1;
    }
    throw err;
  }
}

/** @param {Context} ctx */
async function info({ files, values, io }) {
  const doc = await od.inspect(await readFile(files[0]), { password: values.password });
  if (values.json) {
    io.out(`${JSON.stringify(doc, null, 2)}\n`);
    return;
  }
  const sizes = new Map();
  for (const p of doc.pages) {
    const key = `${p.width} x ${p.height} pt${p.rotation ? `, turned ${p.rotation}` : ''}`;
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const lines = [
    ['Pages', String(doc.pageCount)],
    ['Sizes', [...sizes].map(([k, n]) => `${k} (${n})`).join('; ')],
    ['PDF version', doc.version ?? 'unknown'],
    ['Title', doc.metadata.title],
    ['Author', doc.metadata.author],
    ['Producer', doc.metadata.producer],
    ['Encrypted', doc.encrypted ? 'yes' : 'no'],
    ['Forms', doc.forms],
    ['Signatures', String(doc.signatures)],
    ['Attachments', String(doc.attachments)],
    ['Bookmarks', String(doc.bookmarks)],
    ['Tagged', doc.tagged ? 'yes' : 'no'],
  ].filter(([, v]) => v !== '');
  const width = Math.max(...lines.map(([k]) => k.length));
  io.out(lines.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join('\n') + '\n');
}

/** @param {Context} ctx */
async function render({ files, values, io }) {
  if (values.pages !== undefined) {
    const pages = await od.renderPages(await readFile(files[0]), {
      pages: values.pages,
      dpi: values.dpi ? integer(values.dpi, '--dpi') : undefined,
      width: values.width ? integer(values.width, '--width') : undefined,
      password: values.password,
    });
    const folder = values.output ?? '.';
    for (const p of pages) {
      const target = join(folder, `${stem(files[0])}-${p.page}.png`);
      await writeFile(target, p.data);
      io.out(`${target}  ${p.width} x ${p.height}\n`);
    }
    return;
  }
  const page = values.page ? integer(values.page, '--page') : 1;
  const out = await od.renderPage(await readFile(files[0]), {
    page,
    dpi: values.dpi ? integer(values.dpi, '--dpi') : undefined,
    width: values.width ? integer(values.width, '--width') : undefined,
    password: values.password,
  });
  const target = values.output ?? `${stem(files[0])}-${page}.png`;
  await writeFile(target, out.data);
  io.out(`${target}  ${out.width} x ${out.height}\n`);
}

/** @param {Context} ctx */
async function text({ files, values, io }) {
  const result = await od.extractText(await readFile(files[0]), { pages: values.pages, password: values.password });
  io.out(result.map((p) => p.text).join('\n\f') + '\n');
}

/**
 * @param {Context} ctx
 * @param {'docx' | 'pptx'} kind
 */
async function office({ files, values, io }, kind) {
  const target = values.output ?? `${stem(files[0])}.${kind}`;
  refuseOverwrite(target, files);
  const options = { pages: values.pages, password: values.password, background: values['no-background'] ? false : undefined };
  const bytes = await readFile(files[0]);
  const out = kind === 'docx' ? await od.toDocx(bytes, options) : await od.toPptx(bytes, options);
  await writeFile(target, out);
  io.out(`${target}\n`);
}

/**
 * @param {Context} ctx
 * @param {'markdown' | 'html' | 'json' | 'xlsx'} to
 */
async function structure({ files, values, io }, to) {
  const target = values.output ?? (to === 'xlsx' ? `${stem(files[0])}.xlsx` : undefined);
  if (target) refuseOverwrite(target, files);
  const bytes = await readFile(files[0]);
  const options = { pages: values.pages, password: values.password };
  await withConverter(async (c) => {
    const out = to === 'markdown' ? await c.pdfToMarkdown(bytes, options)
      : to === 'html' ? await c.pdfToHtml(bytes, options)
        : to === 'json' ? `${JSON.stringify(await c.pdfToJson(bytes, options), null, 2)}\n`
          : await c.pdfToXlsx(bytes, options);
    if (target) {
      await writeFile(target, out);
      io.out(`${target}\n`);
    } else {
      io.out(/** @type {string} */ (out).endsWith('\n') ? /** @type {string} */ (out) : `${out}\n`);
    }
  });
}

/** @param {Context} ctx */
async function fields({ files, values, io }) {
  const list = await od.getFormFields(await readFile(files[0]), { password: values.password });
  if (values.json) {
    io.out(`${JSON.stringify(list, null, 2)}\n`);
    return;
  }
  if (!list.length) {
    io.out('No form fields.\n');
    return;
  }
  const width = Math.max(...list.map((f) => f.name.length));
  for (const f of list) {
    const value = Array.isArray(f.value) ? f.value.join(', ') : f.value === null ? '' : String(f.value);
    const notes = [f.required && 'required', f.readOnly && 'read-only', f.options.length && `options: ${f.options.join(', ')}`].filter(Boolean).join('; ');
    io.out(`${f.name.padEnd(width)}  ${f.type.padEnd(8)}  ${value}${notes ? `  (${notes})` : ''}\n`);
  }
}

/**
 * A JSON file named by an option, such as --values values.json.
 *
 * @param {Context} ctx
 * @param {string} name
 */
async function jsonFile(ctx, name) {
  const path = required(ctx, name);
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') throw err;
    throw new od.OpenDocumentsError('INVALID_OPTION', `${path} is not valid JSON.`);
  }
}

/** @param {Context} ctx */
async function ocr(ctx) {
  const { files, values, io } = ctx;
  // loaded only here: Tesseract is large and the other commands never need it
  const { createOcr } = await import('@open-documents/ocr');
  const dpi = values.dpi === undefined ? undefined : integer(values.dpi, '--dpi');
  const engine = await createOcr({ languages: values.lang?.split(/[+,]/) });
  try {
    if (values.json) {
      const pages = await engine.recognize(await readFile(files[0]), { pages: values.pages, dpi, password: values.password });
      io.out(`${JSON.stringify(pages, null, 2)}\n`);
      return;
    }
    /** @type {string[]} */
    const lines = [];
    await change(ctx, async (bytes, pw) => {
      const out = await engine.ocr(bytes, {
        ...pw,
        pages: values.pages,
        dpi,
        force: values.force,
        onPage: (r) => {
          lines[r.page] = r.skipped ? `page ${r.page}: has text already, left alone` : `page ${r.page}: read, ${Math.round(/** @type {number} */ (r.confidence))}% sure`;
        },
      });
      io.out(lines.filter(Boolean).join('\n') + '\n');
      return out;
    });
  } finally {
    await engine.close();
  }
}

/** @param {Context} ctx */
async function pdfa(ctx) {
  const { files, values, io } = ctx;
  const part = /** @type {1 | 2 | 3} */ (values.part === undefined ? 2 : integer(values.part, '--part'));
  let bytes = await readFile(files[0]);
  if (!values.check) {
    const target = values.output ?? `${stem(files[0])}-pdfa.pdf`;
    refuseOverwrite(target, files);
    bytes = await od.toPdfA(bytes, { part });
    await writeFile(target, bytes);
    io.out(`${target}\n`);
  }
  const { claimed, problems } = await od.checkPdfA(bytes, { part, password: values.password });
  io.out(claimed ? `Says it is PDF/A-${claimed.part}${claimed.conformance.toLowerCase()}.\n` : 'Does not say it is PDF/A.\n');
  for (const p of problems) io.out(`- ${p.message}${p.pages ? ` (page${p.pages.length > 1 ? 's' : ''} ${p.pages.join(', ')})` : ''}\n`);
  io.out(problems.length ? 'A full validator such as veraPDF would fail it.\n' : 'No common problems found; a full validator such as veraPDF gives the final word.\n');
}

/** @param {Context} ctx */
async function compare({ files, values, io }) {
  const [a, b] = await Promise.all(files.map((f) => readFile(f)));
  const options = { exact: values.exact, password: values.password, passwordB: values['password-b'] };
  if (values.output) {
    refuseOverwrite(values.output, files);
    const sheets = await od.compareReport(a, b, { ...options, labels: [basename(files[0]), basename(files[1])] });
    await writeFile(values.output, sheets);
    await report(io, values.output, sheets);
    return;
  }
  const result = await od.compareText(a, b, options);
  if (values.json) {
    io.out(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.identical) {
    io.out('The text is the same.\n');
    return;
  }
  for (const change of result.changes) {
    const where = change.afterWords[0] ? `page ${change.afterWords[0].page}` : `page ${change.beforeWords[0].page} of the first`;
    if (change.type === 'changed') io.out(`${where}: "${change.before}" became "${change.after}"\n`);
    else if (change.type === 'added') io.out(`${where}: added "${change.after}"\n`);
    else io.out(`${where}: removed "${change.before}"\n`);
  }
  io.out(`${result.changes.length} change${result.changes.length === 1 ? '' : 's'}: ${result.words.removed} words removed, ${result.words.added} added.\n`);
}

/** @param {Context} ctx */
async function merge({ files, values, io }) {
  const inputs = await Promise.all(files.map(async (f) => ({ input: await readFile(f), password: values.password })));
  const target = values.output ?? 'merged.pdf';
  refuseOverwrite(target, files);
  const out = await od.merge(inputs);
  await writeFile(target, out);
  await report(io, target, out);
}

/** @param {Context} ctx */
async function split({ files, values, io }) {
  const options = {
    password: values.password,
    every: values.every === undefined ? undefined : integer(values.every, '--every'),
    ranges: values.ranges === undefined ? undefined : String(values.ranges).split(';'),
    at: values.at === undefined ? undefined : values.at.split(',').map((/** @type {string} */ n) => integer(n.trim(), '--at')),
  };
  const parts = await od.split(await readFile(files[0]), options);
  const folder = values.output ?? '.';
  const digits = String(parts.length).length;
  for (const [i, part] of parts.entries()) {
    const target = join(folder, `${stem(files[0])}-${String(i + 1).padStart(digits, '0')}.pdf`);
    await writeFile(target, part);
    await report(io, target, part);
  }
}

/**
 * @template T
 * @param {(c: ReturnType<typeof createConverter>) => Promise<T>} use
 */
async function withConverter(use) {
  const converter = createConverter();
  try {
    return await use(converter);
  } finally {
    await converter.close();
  }
}

/** @param {Context} ctx */
async function convert({ files, values, io }) {
  const converter = createConverter();
  try {
    const layout = { format: values.paper, landscape: values.landscape };
    if (values.url) {
      const target = values.output ?? 'page.pdf';
      const out = await converter.urlToPdf(values.url, { ...layout, allowHosts: values['allow-host'], javascript: values.javascript ?? true });
      await writeFile(target, out);
      await report(io, target, out);
      return;
    }
    const target = values.output ?? `${stem(files[0])}.pdf`;
    refuseOverwrite(target, files);
    const pdfa = values.pdfa === undefined ? undefined : /** @type {1 | 2 | 3} */ (integer(values.pdfa, '--pdfa'));
    const out = await converter.toPdf(await readFile(files[0]), { ...layout, filename: basename(files[0]), javascript: values.javascript, pdfa });
    await writeFile(target, out);
    await report(io, target, out);
  } finally {
    await converter.close();
  }
}

/** @param {Context} ctx */
async function bookmarks({ files, values, io }) {
  const tree = await od.getBookmarks(await readFile(files[0]), { password: values.password });
  if (values.json) {
    io.out(`${JSON.stringify(tree, null, 2)}\n`);
    return;
  }
  if (!tree.length) {
    io.out('No bookmarks.\n');
    return;
  }
  /** @type {(items: typeof tree, depth: number) => void} */
  const print = (items, depth) => {
    for (const b of items) {
      io.out(`${'  '.repeat(depth)}${b.title}${b.page ? `  (page ${b.page})` : ''}\n`);
      print(b.children, depth + 1);
    }
  };
  print(tree, 0);
}

/** @param {Context} ctx */
async function images({ files, values, io }) {
  const target = values.output ?? 'images.pdf';
  refuseOverwrite(target, files);
  const size = values['page-size'];
  const out = await od.imagesToPdf(await Promise.all(files.map((f) => readFile(f))), {
    pageSize: size,
    margin: values.margin === undefined ? undefined : number(values.margin, '--margin'),
    title: values.title,
  });
  await writeFile(target, out);
  await report(io, target, out);
}

/**
 * Read one file, change it, write the result.
 *
 * @param {Context} ctx
 * @param {(bytes: Uint8Array, password: { password?: string }) => Promise<Uint8Array>} op
 */
async function change(ctx, op) {
  const { files, values, io, command } = ctx;
  const target = values.output ?? `${stem(files[0])}-${command}.pdf`;
  refuseOverwrite(target, files);
  const out = await op(await readFile(files[0]), { password: values.password });
  await writeFile(target, out);
  await report(io, target, out);
}

/**
 * @param {Io} io
 * @param {string} target
 * @param {Uint8Array} bytes
 */
async function report(io, target, bytes) {
  const { pageCount } = await od.inspect(bytes).catch(() => ({ pageCount: '?' }));
  io.out(`${target}  ${pageCount} page${pageCount === 1 ? '' : 's'}\n`);
}

/**
 * @param {string} target
 * @param {string[]} inputs
 */
function refuseOverwrite(target, inputs) {
  if (inputs.some((f) => resolve(f) === resolve(target))) {
    throw new od.OpenDocumentsError('INVALID_OPTION', `Not writing over the input file ${target}. Pick another name with -o.`);
  }
}

/**
 * @param {Context} ctx
 * @param {string} name
 * @returns {string}
 */
function required(ctx, name) {
  const value = ctx.values[name];
  if (value === undefined) throw new od.OpenDocumentsError('INVALID_OPTION', `opendocs ${ctx.command} needs --${name}.`);
  return value;
}

/** @param {Context} ctx */
function style(ctx) {
  const v = ctx.values;
  return {
    size: v.size === undefined ? undefined : number(v.size, '--size'),
    color: v.color,
    opacity: v.opacity === undefined ? undefined : number(v.opacity, '--opacity'),
    font: v.font,
    pages: v.pages,
  };
}

/**
 * "left|center|right", any part may be empty.
 * @param {string | undefined} value
 */
function band(value) {
  if (value === undefined) return undefined;
  const [left, center, right] = value.split('|');
  /** @type {Record<string, string>} */
  const out = {};
  if (left) out.left = left;
  if (center) out.center = center;
  if (right) out.right = right;
  return out;
}

/** @param {string} value */
function point(value) {
  const parts = value.split(',').map((n) => number(n.trim(), '--at'));
  if (parts.length !== 2) throw new od.OpenDocumentsError('INVALID_OPTION', '--at takes x,y in points from the top left.');
  return { x: parts[0], y: parts[1] };
}

/**
 * @param {Context} ctx
 * @param {string} name
 */
function optionalInteger(ctx, name) {
  return ctx.values[name] === undefined ? undefined : integer(ctx.values[name], `--${name}`);
}

/** @param {Context} ctx */
function grid(ctx) {
  return {
    columns: ctx.values.columns === undefined ? undefined : integer(ctx.values.columns, '--columns'),
    rows: ctx.values.rows === undefined ? undefined : integer(ctx.values.rows, '--rows'),
  };
}

/**
 * "36" for every edge, or "top,right,bottom,left".
 * @param {string} value
 */
function margins(value) {
  const parts = value.split(',').map((n) => number(n.trim(), '--margins'));
  if (parts.length === 1) return parts[0];
  if (parts.length !== 4) throw new od.OpenDocumentsError('INVALID_OPTION', '--margins takes one number or four: top,right,bottom,left.');
  const [top, right, bottom, left] = parts;
  return { top, right, bottom, left };
}

/**
 * @param {string} value
 * @param {string} name
 */
function integer(value, name) {
  if (!/^-?\d+$/.test(value)) throw new od.OpenDocumentsError('INVALID_OPTION', `${name} must be a whole number.`);
  return Number(value);
}

/**
 * @param {string} value
 * @param {string} name
 * @param {boolean} [signed]
 */
function number(value, name, signed = false) {
  const pattern = signed ? /^-?\d+(\.\d+)?$/ : /^\d*\.?\d+$/;
  if (!pattern.test(value)) throw new od.OpenDocumentsError('INVALID_OPTION', `${name} must be a number.`);
  return Number(value);
}

/** @param {string} file */
function stem(file) {
  return basename(file, extname(file));
}
