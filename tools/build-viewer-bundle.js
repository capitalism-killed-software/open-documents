#!/usr/bin/env node
// The viewer as one file, for pages without a bundler: dist/od-viewer.js with pdfium.wasm next
// to it, and THIRD_PARTY_LICENSES.txt with the licence of every package inside, which MIT and
// the others ask to travel with the code. Built when the viewer is packed, never committed.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * @typedef {object} BundledPackage
 * @property {string} name
 * @property {string} version
 * @property {string} license
 * @property {string} text  the package's licence file, or a note that it has none
 */

/**
 * @param {string} outDir
 * @returns {Promise<{ packages: BundledPackage[] }>}
 */
export async function buildViewerBundle(outDir) {
  await mkdir(outDir, { recursive: true });
  const result = await build({
    entryPoints: [join(root, 'packages/viewer/src/index.js')],
    absWorkingDir: root,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none', // they are all in THIRD_PARTY_LICENSES.txt, in full
    metafile: true,
    outfile: join(outDir, 'od-viewer.js'),
    logLevel: 'silent',
  });
  await copyFile(fileURLToPath(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')), join(outDir, 'pdfium.wasm'));
  const packages = await bundledPackages(Object.keys(result.metafile.inputs));
  await writeFile(join(outDir, 'THIRD_PARTY_LICENSES.txt'), notice(packages));
  return { packages };
}

/**
 * The npm packages the bundle took code from, from the files esbuild read.
 *
 * @param {string[]} inputs  paths relative to the repository root
 * @returns {Promise<BundledPackage[]>}
 */
async function bundledPackages(inputs) {
  const dirs = new Set();
  for (const input of inputs) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll('\\', '/'));
    if (match) dirs.add(match[1]);
  }
  const packages = await Promise.all([...dirs].map(async (dir) => {
    const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'));
    const file = (await readdir(join(root, dir))).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    const text = file ? (await readFile(join(root, dir, file), 'utf8')).trim() : `(The package has no licence file. Its package.json says ${manifest.license}.)`;
    return { name: manifest.name, version: manifest.version, license: manifest.license ?? 'UNKNOWN', text };
  }));
  // a package found twice at different paths (nested copies) is listed once per version
  const unique = new Map(packages.map((p) => [`${p.name}@${p.version}`, p]));
  return [...unique.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

/** @param {BundledPackage[]} packages */
function notice(packages) {
  const head = 'od-viewer.js, the bundled build of @open-documents/viewer, contains code from these packages.\nTheir licences follow.\n';
  return `${head}\n${packages.map((p) => `== ${p.name} ${p.version} (${p.license}) ==\n\n${p.text}\n`).join('\n')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(root, 'packages/viewer/dist');
  const { packages } = await buildViewerBundle(out);
  console.log(`viewer bundle: packages/viewer/dist (${packages.length} packages listed in THIRD_PARTY_LICENSES.txt)`);
}
