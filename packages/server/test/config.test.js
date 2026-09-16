import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from '../src/config.js';

test('defaults: this machine only, no keys, 50 MB, no web pages', () => {
  const c = configFromEnv({});
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3000);
  assert.deepEqual(c.server.apiKeys, []);
  assert.equal(c.server.maxFileSize, 50 * 1024 * 1024);
  assert.equal(c.server.allowUrl, false);
});

test('settings from the environment', () => {
  const c = configFromEnv({
    HOST: '0.0.0.0', PORT: '8080', OPENDOCS_API_KEYS: 'aaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbb', OPENDOCS_MAX_FILE_MB: '5',
    OPENDOCS_ALLOW_URL: '1', OPENDOCS_ALLOW_HOSTS: 'wiki.internal, 10.0.0.8', OPENDOCS_LOG: '0',
  });
  assert.deepEqual([c.host, c.port], ['0.0.0.0', 8080]);
  assert.deepEqual(c.server.apiKeys, ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  assert.equal(c.server.maxFileSize, 5 * 1024 * 1024);
  assert.deepEqual(c.server.allowHosts, ['wiki.internal', '10.0.0.8']);
  assert.equal(c.server.logger, false);
});

test('refuses to listen openly without keys, and weak keys', () => {
  assert.throws(() => configFromEnv({ HOST: '0.0.0.0' }), /without API keys/);
  assert.doesNotThrow(() => configFromEnv({ HOST: '0.0.0.0', OPENDOCS_ALLOW_NO_AUTH: '1' }));
  assert.throws(() => configFromEnv({ OPENDOCS_API_KEYS: 'short' }), /at least 16/);
  assert.throws(() => configFromEnv({ PORT: 'eighty' }), /PORT/);
  assert.throws(() => configFromEnv({ OPENDOCS_MAX_FILE_MB: '0' }), /positive/);
});

test('the command stops with a message on a bad setting', async () => {
  const bin = fileURLToPath(new URL('../bin/opendocs-server.js', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [bin], { env: { ...process.env, HOST: '0.0.0.0', OPENDOCS_API_KEYS: '' } }), (err) => {
    assert.equal(/** @type {any} */ (err).code, 2);
    assert.match(/** @type {any} */ (err).stderr, /Refusing to listen/);
    return true;
  });
});

test('ocr settings: languages, workers and a language folder', () => {
  const plain = configFromEnv({});
  assert.deepEqual([plain.server.ocrLanguages, plain.server.ocrWorkers, plain.server.ocrLangPath], [['eng'], 2, undefined]);
  const c = configFromEnv({ OPENDOCS_OCR_LANGUAGES: 'eng+deu, fra', OPENDOCS_OCR_WORKERS: '4', OPENDOCS_OCR_LANG_PATH: '/tessdata' });
  assert.deepEqual([c.server.ocrLanguages, c.server.ocrWorkers, c.server.ocrLangPath], [['eng', 'deu', 'fra'], 4, '/tessdata']);
  assert.throws(() => configFromEnv({ OPENDOCS_OCR_WORKERS: '0' }), /OPENDOCS_OCR_WORKERS/);
});

test('signature settings: a timestamp authority and trust roots', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const folder = await mkdtemp(join(tmpdir(), 'od-roots-'));
  try {
    await writeFile(join(folder, 'roots.pem'), '-----BEGIN CERTIFICATE-----\n');
    const c = configFromEnv({ OPENDOCS_TIMESTAMP_URL: 'https://tsa.example/', OPENDOCS_TRUST_ROOTS: join(folder, 'roots.pem') });
    assert.equal(c.server.timestampUrl, 'https://tsa.example/');
    assert.equal(c.server.trustRoots?.length, 1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
