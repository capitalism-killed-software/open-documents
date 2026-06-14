#!/usr/bin/env node
// Type declarations for the published packages, made from the JSDoc in the plain JavaScript
// sources. They are built when a package is packed, never committed.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const packages = process.argv.slice(2).length ? process.argv.slice(2) : ['core', 'node', 'server', 'client', 'viewer', 'ocr'];

for (const name of packages) {
  const dir = join(root, 'packages', name);
  rmSync(join(dir, 'types'), { recursive: true, force: true });
  execFileSync(process.execPath, [
    tsc,
    '--allowJs', '--declaration', '--emitDeclarationOnly', '--skipLibCheck',
    '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext',
    '--rootDir', join(dir, 'src'), '--outDir', join(dir, 'types'),
    join(dir, 'src', 'index.js'),
  ], { stdio: 'inherit' });
  console.log(`types: packages/${name}/types`);
}
