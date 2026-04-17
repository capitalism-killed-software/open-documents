// Structural work on PDFs with qpdf (Apache-2.0): lossless compression, fast web view
// (linearization) and repair. qpdf runs as a separate program; passwords reach it through a
// file, never the command line, where other users of the machine could read them.
import { access, mkdtemp, readFile, rm, writeFile, constants } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenDocumentsError } from '@open-documents/core';
import { run } from './run.js';

/**
 * Where qpdf is: $OPENDOCS_QPDF, then qpdf on the PATH, then a copy fetched into this
 * repository's .bin/ by `npm run fetch-binaries` (development only).
 *
 * @returns {Promise<string | null>}
 */
export async function findQpdf() {
  if (process.env.OPENDOCS_QPDF) return process.env.OPENDOCS_QPDF;
  const name = process.platform === 'win32' ? 'qpdf.exe' : 'qpdf';
  const fetched = fileURLToPath(new URL(`../../../.bin/qpdf-12.3.2/bin/${name}`, import.meta.url));
  for (const path of [...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, name)), fetched]) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * @param {{ binary?: string, timeout?: number }} [options]
 */
export async function createQpdf(options = {}) {
  const binary = options.binary ?? (await findQpdf());
  if (!binary) throw new OpenDocumentsError('ENGINE_MISSING', 'qpdf is not installed. Install it, or set OPENDOCS_QPDF.');
  const timeout = options.timeout ?? 120_000;

  /**
   * @param {Uint8Array} bytes
   * @param {string[]} args  between the input and the output
   * @param {{ password?: string, what: string }} opts
   */
  const transform = async (bytes, args, opts) => {
    const dir = await mkdtemp(join(tmpdir(), 'od-qpdf-'));
    try {
      const input = join(dir, 'in.pdf');
      const output = join(dir, 'out.pdf');
      await writeFile(input, bytes);
      const pre = [];
      if (opts.password) {
        await writeFile(join(dir, 'pw'), opts.password, { mode: 0o600 });
        pre.push(`--password-file=${join(dir, 'pw')}`);
      }
      const result = await run(binary, ['--warning-exit-0', '--no-original-object-ids', ...pre, ...args, input, output], { timeout, cwd: dir });
      if (result.timedOut) throw new OpenDocumentsError('TIMEOUT', `qpdf took longer than ${Math.round(timeout / 1000)} s to ${opts.what}.`);
      if (result.code !== 0) {
        const why = result.stderr.trim().split('\n').pop() ?? '';
        if (/invalid password/i.test(result.stderr)) throw new OpenDocumentsError('PASSWORD_REQUIRED', 'The file is encrypted: the password is missing or wrong.');
        throw new OpenDocumentsError('DAMAGED_FILE', `qpdf could not ${opts.what}${why ? `: ${why.replace(/^.*?: /, '')}` : '.'}`);
      }
      return new Uint8Array(await readFile(output));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  return {
    binary,
    /**
     * Smaller without losing anything: streams recompressed at the highest level, objects packed
     * into object streams, unused resources dropped. Images are left as they are.
     *
     * @param {Uint8Array} bytes
     * @param {{ password?: string }} [opts]
     */
    compress: (bytes, opts = {}) =>
      transform(bytes, ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', '--remove-unreferenced-resources=yes'], { ...opts, what: 'compress the file' }),
    /**
     * Fast web view: the first page can be shown before the whole file has downloaded.
     *
     * @param {Uint8Array} bytes
     * @param {{ password?: string }} [opts]
     */
    linearize: (bytes, opts = {}) => transform(bytes, ['--linearize'], { ...opts, what: 'linearize the file' }),
    /**
     * Rebuild the cross-reference table and write a clean file; qpdf reconstructs what it can.
     *
     * @param {Uint8Array} bytes
     * @param {{ password?: string }} [opts]
     */
    repair: (bytes, opts = {}) => transform(bytes, [], { ...opts, what: 'repair the file' }),
    /**
     * qpdf's own structural check.
     *
     * @param {Uint8Array} bytes
     * @returns {Promise<{ ok: boolean, messages: string[] }>}
     */
    async check(bytes) {
      const dir = await mkdtemp(join(tmpdir(), 'od-qpdf-'));
      try {
        await writeFile(join(dir, 'in.pdf'), bytes);
        const result = await run(binary, ['--check', join(dir, 'in.pdf')], { timeout, cwd: dir });
        const messages = `${result.stdout}\n${result.stderr}`.split('\n').filter((l) => /^(WARNING|ERROR)\b|errors detected/.test(l));
        return { ok: result.code === 0 && messages.length === 0, messages };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
