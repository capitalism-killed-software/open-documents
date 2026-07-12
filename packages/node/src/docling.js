// Docling (MIT) reads a PDF's structure: headings, paragraphs, lists, tables, reading order.
// It runs in a Python worker that this module starts once and keeps warm, because loading its
// models takes seconds. One document at a time per worker; a worker that hangs or dies is
// replaced on the next request.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { OpenDocumentsError, extractPages, inspect } from '@open-documents/core';

export const PYTHON_DIR = fileURLToPath(new URL('../python/', import.meta.url));
const STDERR_KEEP = 4000;

/**
 * @typedef {object} DoclingOptions
 * @property {string} [python]   a Python that has Docling; default OPENDOCS_PYTHON, then the
 *   worker's own environment made by `uv sync` in the python folder of this package
 * @property {string} [models]   Docling's model folder; default OPENDOCS_DOCLING_MODELS, then
 *   ~/.cache/open-documents/docling-models
 * @property {number} [timeout]  milliseconds per document; default 300000
 * @property {number} [maxJobs]  documents before the worker is replaced; default 50
 * @property {string} [workDir]  where job files go; default OPENDOCS_WORK_DIR, then the temp folder
 */

/**
 * @typedef {object} StructureResult
 * @property {number} pages
 * @property {number} tables
 * @property {boolean} partial  some pages could not be read
 * @property {string} [markdown]
 * @property {string} [html]
 * @property {object} [json]  Docling's document, as JSON
 * @property {string} [text]
 * @property {Uint8Array | null} [xlsx]  null when there are no tables
 */

/** @param {DoclingOptions} [options] */
export function findPython(options = {}) {
  const given = options.python ?? process.env.OPENDOCS_PYTHON;
  if (given) return given;
  const own = join(PYTHON_DIR, '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
  return existsSync(own) ? own : null;
}

/** @param {DoclingOptions} [options] */
export function doclingModels(options = {}) {
  return options.models ?? process.env.OPENDOCS_DOCLING_MODELS ?? join(homedir(), '.cache', 'open-documents', 'docling-models');
}

const SETUP = (/** @type {string} */ models) =>
  `cd ${PYTHON_DIR} && uv sync --frozen && uv run docling-tools models download layout tableformer -o ${models}`;

/**
 * @param {DoclingOptions} [options]
 */
export async function createDocling(options = {}) {
  const python = findPython(options);
  const models = doclingModels(options);
  if (!python) throw new OpenDocumentsError('ENGINE_MISSING', `Docling is not set up. Run: ${SETUP(models)}`);
  if (!existsSync(models)) throw new OpenDocumentsError('ENGINE_MISSING', `No Docling models in ${models}. Run: ${SETUP(models)}`);
  const timeout = options.timeout ?? 300_000;
  const maxJobs = options.maxJobs ?? 50;
  const workDir = options.workDir ?? process.env.OPENDOCS_WORK_DIR ?? tmpdir();
  await mkdir(workDir, { recursive: true });
  const home = await mkdtemp(join(workDir, 'docling-'));

  /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
  let child = null;
  let jobs = 0;
  let nextId = 1;
  let stderr = '';
  let closed = false;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const waiting = new Map();
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  const env = {
    PATH: process.env.PATH,
    HOME: home,
    PYTHONPATH: join(PYTHON_DIR, 'src'),
    PYTHONUNBUFFERED: '1',
    OPENDOCS_DOCLING_MODELS: models,
    // nothing is fetched while converting: models come from the folder above
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HOME: join(home, 'hf'),
    ...(process.platform === 'win32' ? { SYSTEMROOT: process.env.SYSTEMROOT, TEMP: home, TMP: home } : { TMPDIR: home }),
  };

  const start = () => {
    stderr = '';
    jobs = 0;
    const proc = spawn(python, ['-u', '-m', 'open_documents_worker'], { cwd: home, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        /** @type {any} */
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const entry = waiting.get(message.id);
        if (!entry) continue;
        waiting.delete(message.id);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new OpenDocumentsError(message.error?.code ?? 'CONVERSION_FAILED', message.error?.message ?? 'Docling failed.'));
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });
    const gone = (/** @type {Error} */ error) => {
      if (child === proc) child = null;
      for (const [id, entry] of waiting) {
        waiting.delete(id);
        entry.reject(error);
      }
    };
    proc.on('error', (err) => {
      const e = /** @type {NodeJS.ErrnoException} */ (err);
      gone(new OpenDocumentsError(e.code === 'ENOENT' ? 'ENGINE_MISSING' : 'ENGINE_ERROR', e.code === 'ENOENT' ? `No Python at ${python}. ${SETUP(models)}` : `Docling could not start: ${e.message}`));
    });
    proc.on('exit', (code, signal) => {
      const tail = stderr.trim().split('\n').slice(-3).join(' ');
      gone(new OpenDocumentsError('ENGINE_ERROR', `The Docling worker stopped (${signal ?? `exit ${code}`})${tail ? `: ${tail}` : ''}`));
    });
    proc.stdin.on('error', () => {});
    return proc;
  };

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {number} [limit]
   */
  const request = (method, params, limit = timeout) => {
    const run = async () => {
      if (closed) throw new OpenDocumentsError('ENGINE_ERROR', 'This Docling worker has been closed.');
      if (child && jobs >= maxJobs) stop(child);
      child ??= start();
      jobs++;
      const proc = child;
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          stop(proc);
          reject(new OpenDocumentsError('TIMEOUT', `Docling took longer than ${Math.round(limit / 1000)} seconds.`));
        }, limit);
        waiting.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  };

  /** @param {import('node:child_process').ChildProcess} proc */
  const stop = (proc) => {
    if (child === proc) child = null;
    proc.kill('SIGKILL');
  };

  return {
    /** The Docling version, starting the worker if it is not running. */
    async version() {
      return /** @type {{ docling: string }} */ (await request('ping', {}, 120_000)).docling;
    },

    /**
     * @param {Uint8Array} pdf
     * @param {{ to: ('markdown' | 'html' | 'json' | 'text' | 'xlsx')[], pages?: import('@open-documents/core').PageSelection, password?: string, timeout?: number }} opts
     * @returns {Promise<StructureResult>}
     */
    async convert(pdf, opts) {
      let bytes = pdf;
      // Docling reads neither encrypted files nor page lists: hand it a plain copy of the pages
      if (opts.pages !== undefined || opts.password !== undefined || (await inspect(pdf)).encrypted) {
        bytes = await extractPages(pdf, opts.pages ?? 'all', { password: opts.password });
      }
      const dir = await mkdtemp(join(home, 'job-'));
      try {
        const path = join(dir, 'input.pdf');
        await writeFile(path, bytes);
        const result = /** @type {any} */ (await request('convert', { path, to: opts.to, out: dir }, opts.timeout));
        if (opts.to.includes('xlsx')) result.xlsx = result.xlsx ? new Uint8Array(await readFile(result.xlsx)) : null;
        delete result.tableSheets;
        return result;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      const proc = child;
      child = null;
      if (proc) {
        proc.stdin.end();
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve(undefined);
          }, 3000);
          proc.once('exit', () => {
            clearTimeout(timer);
            resolve(undefined);
          });
        });
      }
      await rm(home, { recursive: true, force: true });
    },
  };
}
