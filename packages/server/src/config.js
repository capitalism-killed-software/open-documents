// Server settings from the environment, checked before anything starts.
import { readFileSync } from 'node:fs';

/**
 * @typedef {object} Config
 * @property {string} host
 * @property {number} port
 * @property {import('./app.js').ServerOptions} server
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Config}
 */
export function configFromEnv(env) {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, not "${env.PORT}".`);
  const apiKeys = (env.OPENDOCS_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (apiKeys.some((k) => k.length < 16)) throw new Error('Each API key in OPENDOCS_API_KEYS must be at least 16 characters.');
  if (!LOOPBACK.has(host) && !apiKeys.length && env.OPENDOCS_ALLOW_NO_AUTH !== '1') {
    throw new Error(`Refusing to listen on ${host} without API keys. Set OPENDOCS_API_KEYS, or OPENDOCS_ALLOW_NO_AUTH=1 if something in front of this server already checks callers.`);
  }
  const mb = Number(env.OPENDOCS_MAX_FILE_MB ?? 50);
  if (!(mb > 0)) throw new Error('OPENDOCS_MAX_FILE_MB must be a positive number.');
  const ocrLanguages = (env.OPENDOCS_OCR_LANGUAGES ?? 'eng').split(/[,+]/).map((l) => l.trim()).filter(Boolean);
  const ocrWorkers = Number(env.OPENDOCS_OCR_WORKERS ?? 2);
  if (!Number.isInteger(ocrWorkers) || ocrWorkers < 1 || ocrWorkers > 16) throw new Error('OPENDOCS_OCR_WORKERS must be a whole number from 1 to 16.');
  return {
    host,
    port,
    server: {
      ocrLanguages,
      ocrWorkers,
      ocrLangPath: env.OPENDOCS_OCR_LANG_PATH || undefined,
      timestampUrl: env.OPENDOCS_TIMESTAMP_URL || undefined,
      trustRoots: env.OPENDOCS_TRUST_ROOTS ? [readFileSync(env.OPENDOCS_TRUST_ROOTS)] : undefined,
      apiKeys,
      maxFileSize: Math.round(mb * 1024 * 1024),
      allowUrl: env.OPENDOCS_ALLOW_URL === '1',
      allowHosts: (env.OPENDOCS_ALLOW_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean),
      webhookSecret: env.OPENDOCS_WEBHOOK_SECRET || undefined,
      logger: env.OPENDOCS_LOG === '0' ? false : { level: env.OPENDOCS_LOG ?? 'info' },
    },
  };
}
