// Office documents to PDF with LibreOffice, run headless as a separate program.
//
// One LibreOffice process can only convert one document at a time, so conversions share a
// small pool of slots, each with its own user profile. Profiles are locked down before first
// use: macros off, linked content never updated. That is defence in depth only; in production
// the converter runs without network access (see docker/).
import { access, mkdir, mkdtemp, readFile, rm, writeFile, constants } from 'node:fs/promises';
import { homedir, tmpdir, availableParallelism } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenDocumentsError } from '@open-documents/core';
import { run } from './run.js';

/** File extension LibreOffice should see for each kind it converts. */
export const OFFICE_KINDS = {
  docx: 'docx', doc: 'doc', odt: 'odt', rtf: 'rtf', text: 'txt',
  xlsx: 'xlsx', xls: 'xls', ods: 'ods', csv: 'csv',
  pptx: 'pptx', ppt: 'ppt', odp: 'odp', odg: 'odg',
};

const CANDIDATES = [
  '/usr/bin/soffice',
  '/usr/lib/libreoffice/program/soffice',
  '/opt/libreoffice/program/soffice',
  '/snap/bin/libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
];

/**
 * Where LibreOffice is: $OPENDOCS_SOFFICE, then soffice or libreoffice on the PATH, then the
 * usual install places.
 *
 * @returns {Promise<string | null>}
 */
export async function findLibreOffice() {
  if (process.env.OPENDOCS_SOFFICE) return process.env.OPENDOCS_SOFFICE;
  const names = process.platform === 'win32' ? ['soffice.exe'] : ['soffice', 'libreoffice'];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const path of [...dirs.flatMap((d) => names.map((n) => join(d, n))), ...CANDIDATES]) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // keep looking
    }
  }
  return null;
}

// Settings written into every profile before LibreOffice first starts with it.
const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseLocking" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

/**
 * @typedef {object} LibreOfficeOptions
 * @property {string} [binary]      path to soffice; found automatically if left out
 * @property {string} [workDir]     where profiles and job files go. A snap install can only see
 *   its own folders, so for /snap/ binaries the default is ~/snap/libreoffice/common.
 * @property {number} [slots]       conversions at once; default half the CPUs, at most 4
 * @property {number} [timeout]     milliseconds per conversion; default 120 000
 * @property {number} [queueLimit]  conversions allowed to wait; default 100
 */

/**
 * @typedef {object} LibreOffice
 * @property {(bytes: Uint8Array, options: { kind: keyof typeof OFFICE_KINDS, timeout?: number }) => Promise<Uint8Array>} convert
 * @property {() => Promise<void>} close  removes the profiles
 * @property {string} binary
 * @property {string} workDir  this pool's own folder, inside the work dir
 */

/**
 * @param {LibreOfficeOptions} [options]
 * @returns {Promise<LibreOffice>}
 */
export async function createLibreOffice(options = {}) {
  const binary = options.binary ?? (await findLibreOffice());
  if (!binary) throw new OpenDocumentsError('ENGINE_MISSING', 'LibreOffice is not installed. Install it, or set OPENDOCS_SOFFICE to soffice.');
  const workDir = options.workDir ?? process.env.OPENDOCS_WORK_DIR ?? defaultWorkDir(binary);
  const slotCount = options.slots ?? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  const timeout = options.timeout ?? 120_000;
  const queueLimit = options.queueLimit ?? 100;
  await mkdir(workDir, { recursive: true });
  const base = await mkdtemp(join(workDir, 'lo-'));

  const slots = Array.from({ length: slotCount }, (_, i) => ({ profile: join(base, `profile-${i}`), busy: false, ready: false }));
  /** @type {((slot: typeof slots[number]) => void)[]} */
  const waiting = [];

  const acquire = () => {
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (waiting.length >= queueLimit) throw new OpenDocumentsError('BUSY', 'Every converter is busy and the queue is full. Try again shortly.');
    return new Promise((resolve) => waiting.push(resolve));
  };
  /** @param {typeof slots[number]} slot */
  const release = (slot) => {
    const next = waiting.shift();
    if (next) next(slot);
    else slot.busy = false;
  };
  /** @param {typeof slots[number]} slot */
  const prepare = async (slot) => {
    if (slot.ready) return;
    await mkdir(join(slot.profile, 'user'), { recursive: true });
    await writeFile(join(slot.profile, 'user', 'registrymodifications.xcu'), PROFILE);
    slot.ready = true;
  };

  return {
    binary,
    workDir: base,
    async convert(bytes, { kind, timeout: jobTimeout }) {
      const ext = OFFICE_KINDS[kind];
      if (!ext) throw new OpenDocumentsError('INVALID_OPTION', `LibreOffice does not convert ${kind}.`);
      const slot = await acquire();
      const job = await mkdtemp(join(base, 'job-'));
      try {
        await prepare(slot);
        const input = join(job, `input.${ext}`);
        await writeFile(input, bytes);
        const result = await run(binary, [
          '--headless', '--norestore', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
          `-env:UserInstallation=${pathToFileURL(slot.profile).href}`,
          '--convert-to', 'pdf', '--outdir', job, input,
        ], { timeout: jobTimeout ?? timeout, cwd: job, env: minimalEnv() });
        if (result.timedOut) {
          slot.ready = false; // a killed LibreOffice can leave its profile half written
          await rm(slot.profile, { recursive: true, force: true });
          throw new OpenDocumentsError('TIMEOUT', `LibreOffice took longer than ${Math.round((jobTimeout ?? timeout) / 1000)} s and was stopped.`);
        }
        try {
          return new Uint8Array(await readFile(join(job, 'input.pdf')));
        } catch {
          const why = (result.stderr || result.stdout).trim().split('\n').pop() ?? '';
          throw new OpenDocumentsError('CONVERSION_FAILED', `LibreOffice could not convert this ${kind} file${why ? `: ${why}` : '.'}`);
        }
      } finally {
        await rm(job, { recursive: true, force: true });
        release(slot);
      }
    },
    async close() {
      await rm(base, { recursive: true, force: true });
    },
  };
}

/** @param {string} binary */
function defaultWorkDir(binary) {
  if (binary.startsWith('/snap/')) return join(homedir(), 'snap', 'libreoffice', 'common', 'open-documents');
  return join(tmpdir(), 'open-documents');
}

/** Only what LibreOffice needs: never pass the server's secrets to a document converter. */
function minimalEnv() {
  /** @type {Record<string, string>} */
  const env = { LANG: 'C.UTF-8', SAL_USE_VCLPLUGIN: 'svp' };
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'XDG_RUNTIME_DIR', 'SystemRoot', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = /** @type {string} */ (process.env[key]);
  }
  return env;
}
