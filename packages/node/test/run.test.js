import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';

const node = process.execPath;

test('runs a program and collects its output', async () => {
  const r = await run(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'out');
  assert.equal(r.stderr, 'err');
  assert.equal(r.timedOut, false);
});

test('arguments are passed as they are, never through a shell', async () => {
  const r = await run(node, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '$(echo hi)', 'a;b', '"q"']);
  assert.deepEqual(JSON.parse(r.stdout), ['$(echo hi)', 'a;b', '"q"']);
});

test('stdin can be given', async () => {
  const r = await run(node, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'piped' });
  assert.equal(r.stdout, 'piped');
});

test('a program that runs too long is killed, with what it started', async () => {
  const script = `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    console.log(grandchild.pid);
    setInterval(() => {}, 1000);
  `;
  const r = await run(node, ['-e', script], { timeout: 1500 });
  assert.equal(r.timedOut, true);
  const grandchild = Number(r.stdout.trim());
  if (process.platform !== 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.throws(() => process.kill(grandchild, 0), /ESRCH/, 'the grandchild is gone too');
  }
});

test('output beyond the cap is dropped', async () => {
  const r = await run(node, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxOutput: 10 });
  assert.equal(r.stdout, 'xxxxxxxxxx');
});

test('a missing program is reported clearly', async () => {
  await assert.rejects(run('definitely-not-a-real-program-od', []), { code: 'ENGINE_MISSING', message: /not installed/ });
});
