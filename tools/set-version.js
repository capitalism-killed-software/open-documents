#!/usr/bin/env node
// Give every published package the same version, and point them at each other exactly.
// usage: node tools/set-version.js 0.1.0
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version ?? '')) {
  console.error('usage: node tools/set-version.js <version>, like 0.1.0');
  process.exit(2);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['core', 'node', 'server', 'client', 'cli', 'viewer', 'fixtures'];
for (const name of names) {
  const file = join(root, 'packages', name, 'package.json');
  const p = JSON.parse(readFileSync(file, 'utf8'));
  p.version = version;
  for (const field of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(p[field] ?? {})) if (dep.startsWith('@open-documents/')) p[field][dep] = version;
  }
  writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
  console.log(`${p.name} ${version}`);
}
// the examples are not published, but they depend on the packages
for (const name of readdirSync(join(root, 'examples'))) {
  const file = join(root, 'examples', name, 'package.json');
  const p = JSON.parse(readFileSync(file, 'utf8'));
  for (const dep of Object.keys(p.dependencies ?? {})) if (dep.startsWith('@open-documents/')) p.dependencies[dep] = version;
  writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
}
console.log('Now run npm install to update the lockfile.');
