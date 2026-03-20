// HTML to PDF with headless Chromium, through playwright-core.
//
// Uploaded HTML renders with the network off. Every host name fails to resolve, and every
// request is answered from the files that came with the HTML or refused. A page can only see
// what it was given.
import { chromium } from 'playwright-core';
import { OpenDocumentsError } from '@open-documents/core';

const ORIGIN = 'https://document.opendocs.invalid';

/**
 * @typedef {object} PdfLayout
 * @property {'letter' | 'legal' | 'a4' | 'a3' | 'a5' | 'tabloid'} [format]  default letter;
 *   a CSS `@page { size }` rule in the HTML wins
 * @property {{ width: string, height: string }} [size]  e.g. { width: '4in', height: '6in' }
 * @property {boolean} [landscape]
 * @property {{ top?: string, right?: string, bottom?: string, left?: string }} [margin]
 *   CSS lengths; default 0.4in all round
 * @property {number} [scale]  0.1 to 2
 * @property {boolean} [background]  print background colours and images; default true
 * @property {string} [header]  HTML for the top of every page; may use the classes pageNumber
 *   and totalPages, as in <span class="pageNumber"></span>
 * @property {string} [footer]
 */

/**
 * @typedef {PdfLayout & {
 *   assets?: Record<string, Uint8Array | string>,
 *   javascript?: boolean,
 *   timeout?: number,
 *   waitFor?: 'load' | 'networkidle',
 * }} HtmlOptions
 *   assets: files the HTML refers to by relative path, like "logo.png" or "css/print.css".
 *   javascript: run the page's scripts; default false.
 */

/**
 * @typedef {object} ChromiumOptions
 * @property {string} [executablePath]  default $OPENDOCS_CHROMIUM, else Playwright's own build
 * @property {number} [concurrency]     pages at once; default 4
 * @property {number} [timeout]         milliseconds per conversion; default 60 000
 */

/**
 * @param {ChromiumOptions} [options]
 */
export function createChromium(options = {}) {
  const executablePath = options.executablePath ?? process.env.OPENDOCS_CHROMIUM;
  const concurrency = options.concurrency ?? 4;
  const defaultTimeout = options.timeout ?? 60_000;
  /** @type {Promise<import('playwright-core').Browser> | null} */
  let offline = null;
  let active = 0;
  /** @type {(() => void)[]} */
  const waiting = [];

  const launchOffline = () =>
    (offline ??= launch(executablePath, [
      // nothing resolves, so nothing can be fetched, whatever the page tries
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ]).catch((err) => {
      offline = null;
      throw err;
    }));

  const slot = async () => {
    if (active >= concurrency) await new Promise((resolve) => waiting.push(() => resolve(undefined)));
    active++;
  };
  const done = () => {
    active--;
    waiting.shift()?.();
  };

  return {
    /**
     * @param {string} html
     * @param {HtmlOptions} [opts]
     * @returns {Promise<Uint8Array>}
     */
    async htmlToPdf(html, opts = {}) {
      if (typeof html !== 'string') throw new OpenDocumentsError('INVALID_INPUT', 'html must be a string.');
      const assets = new Map(Object.entries(opts.assets ?? {}).map(([name, data]) => [`${ORIGIN}/${name.replace(/^\.?\//, '')}`, data]));
      assets.set(`${ORIGIN}/`, html);
      const browser = await launchOffline();
      await slot();
      const context = await browser.newContext({ javaScriptEnabled: opts.javascript ?? false, acceptDownloads: false, serviceWorkers: 'block' });
      try {
        await context.route('**/*', (route) => {
          const url = route.request().url().split('#')[0].split('?')[0];
          const body = assets.get(url);
          if (body === undefined) return route.abort('blockedbyclient');
          return route.fulfill({ status: 200, body: typeof body === 'string' ? body : Buffer.from(body), contentType: contentType(url) });
        });
        const page = await context.newPage();
        return await withTimeout(opts.timeout ?? defaultTimeout, async () => {
          await page.goto(`${ORIGIN}/`, { waitUntil: opts.waitFor ?? 'load' });
          return toPdf(page, opts);
        });
      } finally {
        await context.close().catch(() => {});
        done();
      }
    },
    async close() {
      const b = await offline?.catch(() => null);
      offline = null;
      await b?.close();
    },
  };
}

/**
 * @param {string | undefined} executablePath
 * @param {string[]} extra
 */
async function launch(executablePath, extra) {
  try {
    return await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--mute-audio', ...extra],
    });
  } catch (err) {
    const message = /** @type {Error} */ (err).message;
    if (/Executable doesn't exist|ENOENT|Failed to launch/.test(message)) {
      throw new OpenDocumentsError('ENGINE_MISSING', 'Chromium is not installed. Run `npx playwright-core install chromium`, or set OPENDOCS_CHROMIUM.', { cause: err });
    }
    throw new OpenDocumentsError('ENGINE_ERROR', 'Chromium failed to start.', { cause: err });
  }
}

/**
 * @param {import('playwright-core').Page} page
 * @param {PdfLayout} opts
 */
async function toPdf(page, opts) {
  const margin = { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in', ...opts.margin };
  if (opts.scale !== undefined && !(opts.scale >= 0.1 && opts.scale <= 2)) throw new OpenDocumentsError('INVALID_OPTION', 'scale must be from 0.1 to 2.');
  const formats = { letter: 'Letter', legal: 'Legal', a4: 'A4', a3: 'A3', a5: 'A5', tabloid: 'Tabloid' };
  if (opts.format && !(opts.format in formats)) throw new OpenDocumentsError('INVALID_OPTION', `format must be one of ${Object.keys(formats).join(', ')}.`);
  const bytes = await page.pdf({
    format: opts.size ? undefined : formats[opts.format ?? 'letter'],
    width: opts.size?.width,
    height: opts.size?.height,
    landscape: opts.landscape ?? false,
    margin,
    scale: opts.scale,
    printBackground: opts.background ?? true,
    preferCSSPageSize: true,
    displayHeaderFooter: Boolean(opts.header || opts.footer),
    headerTemplate: opts.header ?? '<span></span>',
    footerTemplate: opts.footer ?? '<span></span>',
  });
  return new Uint8Array(bytes);
}

/**
 * @template T
 * @param {number} ms
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withTimeout(ms, work) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OpenDocumentsError('TIMEOUT', `The page took longer than ${Math.round(ms / 1000)} s to render and was stopped.`)), ms);
  });
  try {
    return /** @type {T} */ (await Promise.race([work(), limit]));
  } finally {
    clearTimeout(timer);
  }
}

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

/** @param {string} url */
function contentType(url) {
  if (url === `${ORIGIN}/`) return TYPES.html;
  const ext = /\.([a-z0-9]+)$/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return TYPES[/** @type {keyof TYPES} */ (ext)] ?? 'application/octet-stream';
}
