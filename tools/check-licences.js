#!/usr/bin/env node
// Fails when a dependency has a licence we cannot ship, or is a package we never use.
// Reads package-lock.json; the Python worker's uv.lock is added when it exists.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {object} Policy
 * @property {string[]} allow
 * @property {Record<string, string>} deny        package name (or "@scope/*") -> reason
 * @property {Record<string, string>} exceptions  "name@version" -> why it is allowed anyway
 */

/**
 * Is an SPDX expression acceptable? OR needs one side allowed, AND needs both.
 *
 * @param {string} expression
 * @param {Set<string>} allowed
 * @returns {boolean}
 */
export function licenceAllowed(expression, allowed) {
  const tokens = expression.replace(/[()]/g, ' $& ').split(/\s+/).filter(Boolean);
  let i = 0;
  /** @returns {boolean} */
  const parseOr = () => {
    let ok = parseAnd();
    while (tokens[i] === 'OR') {
      i++;
      ok = parseAnd() || ok;
    }
    return ok;
  };
  /** @returns {boolean} */
  const parseAnd = () => {
    let ok = parseAtom();
    while (tokens[i] === 'AND') {
      i++;
      ok = parseAtom() && ok;
    }
    return ok;
  };
  /** @returns {boolean} */
  const parseAtom = () => {
    const token = tokens[i++];
    if (token === '(') {
      const ok = parseOr();
      if (tokens[i++] !== ')') throw new Error(`Unbalanced licence expression: ${expression}`);
      return ok;
    }
    if (token === undefined || token === ')' || token === 'AND' || token === 'OR') {
      throw new Error(`Cannot read licence expression: ${expression}`);
    }
    if (tokens[i] === 'WITH') i += 2; // an exception only ever loosens a licence
    return allowed.has(token.replace(/\+$/, ''));
  };
  const ok = parseOr();
  if (i !== tokens.length) throw new Error(`Cannot read licence expression: ${expression}`);
  return ok;
}

/**
 * @param {string} name
 * @param {Record<string, string>} deny
 * @returns {string | undefined} the reason, when denied
 */
export function deniedReason(name, deny) {
  const lower = name.toLowerCase();
  if (deny[lower]) return deny[lower];
  const scope = lower.startsWith('@') ? `${lower.split('/')[0]}/*` : '';
  return scope ? deny[scope] : undefined;
}

/**
 * @param {{ packages?: Record<string, { name?: string, version?: string, license?: string, link?: boolean }> }} lock
 * @param {Policy} policy
 * @returns {string[]} problems, empty when everything is fine
 */
export function checkLockfile(lock, policy) {
  const allowed = new Set(policy.allow);
  const problems = [];
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || entry.link) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `${name}@${entry.version}`;
    const reason = deniedReason(name, policy.deny);
    if (reason) {
      problems.push(`${id}: never allowed (${reason})`);
      continue;
    }
    if (policy.exceptions[id]) continue;
    if (!entry.license) {
      problems.push(`${id}: no licence declared`);
      continue;
    }
    let ok = false;
    try {
      ok = licenceAllowed(entry.license, allowed);
    } catch (err) {
      problems.push(`${id}: ${/** @type {Error} */ (err).message}`);
      continue;
    }
    if (!ok) problems.push(`${id}: licence ${entry.license} is not on the allow list`);
  }
  return problems;
}

async function cli() {
  const root = new URL('../', import.meta.url);
  const policy = JSON.parse(await readFile(new URL('tools/licence-policy.json', root), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const problems = checkLockfile(lock, policy);
  const count = Object.keys(lock.packages ?? {}).filter((p) => p.includes('node_modules/')).length;
  if (problems.length) {
    console.error(`Licence check failed:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Licences ok: ${count} packages.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await cli();
