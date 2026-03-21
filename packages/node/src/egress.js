// A forward proxy that decides what a rendered web page may reach.
//
// Chromium sends every request through it. The proxy resolves host names itself, refuses
// private, loopback, link-local and other special addresses (cloud metadata at 169.254.169.254
// among them), and then connects to the very address it checked, so a DNS answer cannot change
// between the check and the connection. Redirects and sub-requests are new requests and are
// checked again.
import { createServer, request as httpRequest } from 'node:http';
import { connect, BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

const blocked = new BlockList();
for (const [net, prefix] of /** @type {[string, number][]} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
])) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of /** @type {[string, number][]} */ ([
  ['::', 128], ['::1', 128], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
])) blocked.addSubnet(net, prefix, 'ipv6');

/**
 * Is this an address on the public internet?
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isPublicAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family !== 6) return false;
  const lower = ip.toLowerCase();
  // IPv4 written as IPv6 (::ffff:10.0.0.1) or through NAT64 (64:ff9b::10.0.0.1): judge the IPv4 part
  const embedded = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (embedded) return isPublicAddress(embedded[1]);
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return isPublicAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return !blocked.check(ip, 'ipv6');
}

/**
 * @typedef {object} EgressOptions
 * @property {string[]} [allowHosts]  host names or addresses let through whatever they resolve
 *   to and whatever the port. For intranet pages; each one is a hole in the wall.
 * @property {number[]} [ports]  ports allowed for everyone else; default 80 and 443
 * @property {(host: string) => Promise<{ address: string, family: number }[]>} [lookup]
 */

/**
 * @param {EgressOptions} [options]
 */
export async function createEgressProxy(options = {}) {
  const allowHosts = new Set((options.allowHosts ?? []).map((h) => h.toLowerCase().replace(/^\[|\]$/g, '')));
  const ports = new Set(options.ports ?? [80, 443]);
  const lookup = options.lookup ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
  /** @type {{ host: string, port: number, reason: string }[]} */
  const refused = [];

  /**
   * @param {string} host
   * @param {number} port
   * @returns {Promise<string | null>} the address to connect to, or null when refused
   */
  const resolve = async (host, port) => {
    const name = host.toLowerCase().replace(/^\[|\]$/g, '');
    if (allowHosts.has(name)) return isIP(name) ? name : (await lookup(name).catch(() => []))[0]?.address ?? null;
    if (!ports.has(port)) {
      refused.push({ host: name, port, reason: `port ${port} is not allowed` });
      return null;
    }
    const answers = isIP(name) ? [{ address: name }] : await lookup(name).catch(() => []);
    if (!answers.length) {
      refused.push({ host: name, port, reason: 'the name does not resolve' });
      return null;
    }
    // every answer must be public, or a second lookup could pick the private one
    const bad = answers.find((a) => !isPublicAddress(a.address));
    if (bad) {
      refused.push({ host: name, port, reason: `${bad.address} is not a public address` });
      return null;
    }
    return answers[0].address;
  };

  const server = createServer(async (req, res) => {
    // plain http: the request line carries the full URL
    let target;
    try {
      target = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:') {
      res.writeHead(403).end();
      return;
    }
    const port = Number(target.port || 80);
    const address = await resolve(target.hostname, port);
    if (!address) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Blocked by Open Documents');
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = httpRequest({ host: address, port, method: req.method, path: target.pathname + target.search, headers, setHost: false }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => res.headersSent ? res.destroy() : res.writeHead(502).end());
    req.pipe(upstream);
  });

  // https and websockets: CONNECT host:port, then a tunnel we cannot see into
  server.on('connect', async (req, socket, head) => {
    const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '');
    const address = match ? await resolve(match[1], Number(match[2])) : null;
    if (!match || !address) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = connect(Number(match[2]), address, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () => new Promise((done) => {
      server.closeAllConnections?.();
      server.close(() => done(undefined));
    }),
  };
}
