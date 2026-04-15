#!/usr/bin/env node
// Download the programs in tools/binaries.json into .bin/, checked against their sha256.
// Only for development machines where the system package manager cannot be used.
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'tools/binaries.json'), 'utf8'));
const platform = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;

for (const [name, spec] of Object.entries(manifest)) {
  if (name === 'about') continue;
  const build = spec[platform];
  if (!build) {
    console.log(`${name}: no build listed for ${platform}; install it with your package manager.`);
    continue;
  }
  const dir = join(root, '.bin', `${name}-${spec.version}`);
  const bin = join(dir, build.bin);
  if (await access(bin).then(() => true, () => false)) {
    console.log(`${name} ${spec.version}: already in ${dir}`);
    continue;
  }
  const res = await fetch(build.url);
  if (!res.ok) throw new Error(`${name}: download failed with HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const sum = createHash('sha256').update(data).digest('hex');
  if (sum !== build.sha256) throw new Error(`${name}: checksum ${sum} does not match ${build.sha256}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const archive = join(dir, 'download.zip');
  await writeFile(archive, data);
  // the system unzip keeps the library symlinks these builds rely on
  execFileSync(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', archive, '-C', dir] : ['-q', archive, '-d', dir]);
  await rm(archive);
  console.log(`${name} ${spec.version}: ${bin}`);
}
