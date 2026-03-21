import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { isPublicAddress, createEgressProxy } from '../src/egress.js';

test('public and private addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.5.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', 'not an ip',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

/** @type {string[]} */
const hits = [];
const site = createServer((req, res) => {
  hits.push(String(req.url));
  res.writeHead(200, { 'content-type': 'text/plain' }).end('hello from the site');
});
let sitePort = 0;
before(async () => {
  await new Promise((resolve) => site.listen(0, '127.0.0.1', () => resolve(undefined)));
  sitePort = /** @type {import('node:net').AddressInfo} */ (site.address()).port;
});
after(() => site.close());

/**
 * GET a URL through the proxy, the way a browser does for plain http.
 * @param {string} proxy
 * @param {string} url
 * @returns {Promise<{ status: number, body: string }>}
 */
function viaProxy(proxy, url) {
  const p = new URL(proxy);
  return new Promise((resolve, reject) => {
    const host = URL.canParse(url) ? new URL(url).host : 'unknown';
    const req = request({ host: p.hostname, port: p.port, path: url, method: 'GET', headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Open a CONNECT tunnel through the proxy and report the status line.
 * @param {string} proxy
 * @param {string} target  host:port
 * @returns {Promise<number>}
 */
function tunnel(proxy, target) {
  const p = new URL(proxy);
  return new Promise((resolve, reject) => {
    const req = request({ host: p.hostname, port: p.port, method: 'CONNECT', path: target });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('loopback is refused, by address and by name', async () => {
  const proxy = await createEgressProxy({ ports: [sitePort] });
  try {
    hits.length = 0;
    assert.equal((await viaProxy(proxy.url, `http://127.0.0.1:${sitePort}/secret`)).status, 403);
    assert.equal((await viaProxy(proxy.url, `http://localhost:${sitePort}/secret`)).status, 403);
    assert.equal(await tunnel(proxy.url, `127.0.0.1:${sitePort}`), 403);
    assert.deepEqual(hits, []);
    assert.match(proxy.refused[0].reason, /not a public address/);
  } finally {
    await proxy.close();
  }
});

test('a name that resolves to a private address is refused, even with one public answer', async () => {
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }];
  const proxy = await createEgressProxy({ lookup });
  try {
    assert.equal((await viaProxy(proxy.url, 'http://mixed.example/')).status, 403);
    assert.match(proxy.refused[0].reason, /10\.0\.0\.5/);
  } finally {
    await proxy.close();
  }
});

test('only ports 80 and 443 by default; names that do not resolve are refused', async () => {
  const proxy = await createEgressProxy({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] });
  try {
    assert.equal(await tunnel(proxy.url, 'example.com:22'), 403);
    assert.match(proxy.refused[0].reason, /port 22/);
  } finally {
    await proxy.close();
  }
  const nowhere = await createEgressProxy({ lookup: async () => [] });
  try {
    assert.equal((await viaProxy(nowhere.url, 'http://nowhere.example/')).status, 403);
    assert.match(nowhere.refused[0].reason, /does not resolve/);
  } finally {
    await nowhere.close();
  }
});

test('allowed hosts get through, over http and through a tunnel', async () => {
  const proxy = await createEgressProxy({ allowHosts: ['127.0.0.1'] });
  try {
    hits.length = 0;
    const res = await viaProxy(proxy.url, `http://127.0.0.1:${sitePort}/page?x=1`);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'hello from the site');
    assert.deepEqual(hits, ['/page?x=1']);
    assert.equal(await tunnel(proxy.url, `127.0.0.1:${sitePort}`), 200);
  } finally {
    await proxy.close();
  }
});

test('requests that are not plain http urls are refused', async () => {
  const proxy = await createEgressProxy({ allowHosts: ['127.0.0.1'] });
  try {
    assert.equal((await viaProxy(proxy.url, '/relative')).status, 400);
    assert.equal((await viaProxy(proxy.url, `ftp://127.0.0.1:${sitePort}/`)).status, 403);
    assert.equal(await tunnel(proxy.url, 'nonsense'), 403);
  } finally {
    await proxy.close();
  }
});
