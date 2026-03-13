// Run another program safely: a wall-clock limit that kills the whole process tree, a cap on
// how much output is kept, and no shell, so arguments are never interpreted.
import { spawn } from 'node:child_process';
import { OpenDocumentsError } from '@open-documents/core';

/**
 * @typedef {object} RunOptions
 * @property {number} [timeout]    milliseconds; default 120 000
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]  replaces the environment when given
 * @property {number} [maxOutput]  bytes of stdout and of stderr to keep; default 1 MB each
 * @property {Uint8Array | string} [input]  written to stdin
 */

/**
 * @typedef {object} RunResult
 * @property {number | null} code
 * @property {string | null} signal
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut
 * @property {number} ms
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {RunOptions} [options]
 * @returns {Promise<RunResult>}
 */
export function run(command, args, options = {}) {
  const timeout = options.timeout ?? 120_000;
  const maxOutput = options.maxOutput ?? 1_000_000;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // its own process group, so a timeout can kill everything it started
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (err) {
      reject(new OpenDocumentsError('ENGINE_ERROR', `Could not start ${command}.`, { cause: err }));
      return;
    }
    const out = collector(maxOutput);
    const err = collector(maxOutput);
    child.stdout.on('data', out.push);
    child.stderr.on('data', err.push);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill(child);
    }, timeout);
    child.on('error', (e) => {
      clearTimeout(timer);
      const missing = /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT';
      reject(new OpenDocumentsError(missing ? 'ENGINE_MISSING' : 'ENGINE_ERROR', missing ? `${command} is not installed or not on the PATH.` : `${command} failed to start.`, { cause: e }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: out.text(), stderr: err.text(), timedOut, ms: Math.round(performance.now() - started) });
    });
    child.stdin.on('error', () => {}); // the program may exit without reading its input
    child.stdin.end(options.input ?? undefined);
  });
}

/** @param {import('node:child_process').ChildProcess} child */
function kill(child) {
  try {
    if (process.platform === 'win32' || !child.pid) child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

/** @param {number} max */
function collector(max) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  return {
    /** @param {Buffer} chunk */
    push: (chunk) => {
      if (size >= max) return;
      chunks.push(chunk.subarray(0, max - size));
      size += chunk.length;
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}
