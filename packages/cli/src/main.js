import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import * as od from '@open-documents/core';

const USAGE = `opendocs: inspect, render and change PDF files

Look:
  opendocs info <file.pdf> [--json]
  opendocs text <file.pdf> [--pages 1-3,5]
  opendocs render <file.pdf> [--page N] [--dpi N | --width PX] [-o out.png]

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
  help: { type: 'boolean', short: 'h' },
};

/**
 * @typedef {object} Context
 * @property {string[]} files
 * @property {Record<string, any>} values
 * @property {Io} io
 * @property {string} command
 */

/** @type {Record<string, { files: 'one' | 'many', run: (ctx: Context) => Promise<void> }>} */
const COMMANDS = {
  info: { files: 'one', run: info },
  text: { files: 'one', run: text },
  render: { files: 'one', run: render },
  merge: { files: 'many', run: merge },
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
  if (files.length === 0 || (spec.files === 'one' && files.length > 1) || (command === 'merge' && files.length < 2)) {
    io.err(command === 'merge' ? 'opendocs merge needs two or more PDF files.\n' : `opendocs ${command} needs one PDF file.\n`);
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
 */
function number(value, name) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new od.OpenDocumentsError('INVALID_OPTION', `${name} must be a number of points.`);
  return Number(value);
}

/** @param {string} file */
function stem(file) {
  return basename(file, extname(file));
}
