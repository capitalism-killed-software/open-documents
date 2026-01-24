import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { inspect, renderPage, extractText, pageRanges, OpenDocumentsError } from '@open-documents/core';

const USAGE = `opendocs: inspect, render and change PDF files

Usage:
  opendocs info <file.pdf> [--json]
  opendocs render <file.pdf> [--page N] [--dpi N | --width PX] [-o out.png]
  opendocs text <file.pdf> [--pages 1-3,5]

Options:
  --password <pw>   for encrypted files
  -h, --help        show this
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
  help: { type: 'boolean', short: 'h' },
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
  const [command, file] = positionals;
  if (values.help || !command) {
    io.out(USAGE);
    return values.help ? 0 : 2;
  }
  const commands = { info, render, text };
  const run = commands[/** @type {keyof commands} */ (command)];
  if (!run) {
    io.err(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
  }
  if (!file) {
    io.err(`opendocs ${command} needs a PDF file.\n`);
    return 2;
  }

  try {
    const bytes = await readFile(file);
    await run(bytes, file, /** @type {Record<string, any>} */ (values), io);
    return 0;
  } catch (err) {
    if (err instanceof OpenDocumentsError) {
      io.err(`error: ${err.message}\n`);
      return 1;
    }
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT') {
      io.err(`error: no such file: ${file}\n`);
      return 1;
    }
    throw err;
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {string} _file
 * @param {Record<string, any>} values
 * @param {Io} io
 */
async function info(bytes, _file, values, io) {
  const doc = await inspect(bytes, { password: values.password });
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

/**
 * @param {Uint8Array} bytes
 * @param {string} file
 * @param {Record<string, any>} values
 * @param {Io} io
 */
async function render(bytes, file, values, io) {
  const page = values.page ? wholeNumber(values.page, '--page') : 1;
  const out = await renderPage(bytes, {
    page,
    dpi: values.dpi ? wholeNumber(values.dpi, '--dpi') : undefined,
    width: values.width ? wholeNumber(values.width, '--width') : undefined,
    password: values.password,
  });
  const target = values.output ?? `${basename(file, extname(file))}-${page}.png`;
  await writeFile(target, out.data);
  io.out(`${target}  ${out.width} x ${out.height}\n`);
}

/**
 * @param {Uint8Array} bytes
 * @param {string} _file
 * @param {Record<string, any>} values
 * @param {Io} io
 */
async function text(bytes, _file, values, io) {
  let pages;
  if (values.pages) {
    const { pageCount } = await inspect(bytes, { password: values.password });
    pages = pageRanges(values.pages, pageCount);
  }
  const result = await extractText(bytes, { pages, password: values.password });
  io.out(result.map((p) => p.text).join('\n\f') + '\n');
}

/**
 * @param {string} value
 * @param {string} name
 */
function wholeNumber(value, name) {
  if (!/^\d+$/.test(value)) throw new OpenDocumentsError('INVALID_OPTION', `${name} must be a whole number.`);
  return Number(value);
}
