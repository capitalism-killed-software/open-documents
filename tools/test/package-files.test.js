// Apache-2.0 asks that the licence and the NOTICE file travel with every copy, so each published
// package carries both, the same as the repository's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const PUBLISHED = ['core', 'node', 'server', 'client', 'cli', 'viewer', 'ocr'];
const root = (/** @type {string} */ file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');

test('every published package carries the licence and the NOTICE file', async () => {
  const [licence, notice] = await Promise.all([root('LICENSE'), root('NOTICE')]);
  for (const name of PUBLISHED) {
    assert.equal(await root(`packages/${name}/LICENSE`), licence, `${name}/LICENSE is the repository's`);
    assert.equal(await root(`packages/${name}/NOTICE`), notice, `${name}/NOTICE is the repository's`);
    const manifest = JSON.parse(await root(`packages/${name}/package.json`));
    // npm packs LICENSE by itself, but NOTICE only when it is listed
    assert.ok(manifest.files.includes('NOTICE'), `${name} lists NOTICE in files`);
    assert.equal(manifest.license, 'Apache-2.0');
  }
});
