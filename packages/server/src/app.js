// The HTTP API. Every endpoint takes files as multipart form data and its settings as a JSON
// `options` field, and answers with a PDF, a zip, a PNG or JSON. Errors are JSON:
// { "error": { "code": "...", "message": "..." } }.
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createHash, timingSafeEqual } from 'node:crypto';
import { OpenDocumentsError } from '@open-documents/core';
import { createConverter } from '@open-documents/node';
import { createOcr } from '@open-documents/ocr';
import { OPERATIONS } from './operations.js';
import { createJobs } from './jobs.js';
import { checkWebhook, deliver } from './webhooks.js';

const STATUS = {
  INVALID_INPUT: 400,
  INVALID_OPTION: 400,
  PAGE_NOT_FOUND: 400,
  PASSWORD_REQUIRED: 422,
  UNSUPPORTED_SECURITY: 422,
  DAMAGED_FILE: 422,
  CONVERSION_FAILED: 422,
  BLOCKED: 403,
  BUSY: 503,
  TIMEOUT: 504,
  ENGINE_MISSING: 501,
  ENGINE_ERROR: 500,
};

/**
 * @typedef {object} ServerOptions
 * @property {string[]} [apiKeys]       when set, every /v1 request needs `Authorization: Bearer <key>`
 * @property {number} [maxFileSize]     bytes per uploaded file; default 50 MB
 * @property {number} [maxFiles]        files per request; default 50
 * @property {boolean} [allowUrl]       allow /v1/convert/url; default false
 * @property {string[]} [allowHosts]    private hosts web pages may reach (server setting only)
 * @property {string} [webhookSecret]  signs webhooks; webhooks are refused without it
 * @property {number[]} [webhookDelays]  retry delays in milliseconds
 * @property {{ ttl?: number, concurrency?: number, maxJobs?: number }} [jobs]
 * @property {any} [converter]  from createConverter() in @open-documents/node; made on first use if left out
 * @property {string[]} [ocrLanguages]  what OCR reads, e.g. ["eng", "deu"]; default ["eng"]
 * @property {number} [ocrWorkers]      pages read at once; default 2
 * @property {string} [ocrLangPath]     folder of <code>.traineddata.gz files, instead of the npm packages
 * @property {any} [ocr]  from createOcr() in @open-documents/ocr; started on first use if left out
 * @property {boolean | object} [logger]
 */

/**
 * @param {ServerOptions} [options]
 */
export async function buildServer(options = {}) {
  const maxFileSize = options.maxFileSize ?? 50 * 1024 * 1024;
  const converter = options.converter ?? createConverter();
  const ocrLanguages = options.ocrLanguages ?? ['eng'];
  /** @type {Promise<any> | undefined} */
  let ocrEngine;
  /** @param {Record<string, any>} o */
  const ocr = async (o) => {
    if (o.languages !== undefined && (!Array.isArray(o.languages) || !o.languages.every((l) => ocrLanguages.includes(l)))) {
      throw new OpenDocumentsError('INVALID_OPTION', `This server reads ${ocrLanguages.join(', ')}. Languages are chosen when it starts (OPENDOCS_OCR_LANGUAGES).`);
    }
    if (options.ocr) return options.ocr;
    ocrEngine ??= createOcr({ languages: ocrLanguages, workers: options.ocrWorkers, langPath: options.ocrLangPath }).catch((e) => {
      ocrEngine = undefined;
      throw e;
    });
    return ocrEngine;
  };
  const keys = (options.apiKeys ?? []).filter(Boolean).map((k) => createHash('sha256').update(k).digest());

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: Math.min(maxFileSize, 20 * 1024 * 1024) });
  app.decorateRequest('owner', 'anonymous');
  /** @type {Map<string, string>} */
  const resultLinks = new Map();
  const webhookOptions = { secret: options.webhookSecret ?? '', allowHosts: options.allowHosts, delays: options.webhookDelays };
  const jobs = createJobs({
    ...options.jobs,
    onDone: (job) => {
      const link = resultLinks.get(job.id);
      resultLinks.delete(job.id);
      if (job.webhook && link) deliver(job, link, webhookOptions).catch(() => {});
    },
  });
  await app.register(multipart, { limits: { fileSize: maxFileSize, files: options.maxFiles ?? 50, fields: 20, fieldSize: 1024 * 1024 } });

  app.addHook('onRequest', async (req, reply) => {
    if (!keys.length || !req.url.startsWith('/v1/')) return;
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const hash = given ? createHash('sha256').update(given).digest() : null;
    if (!hash || !keys.some((k) => timingSafeEqual(k, hash))) {
      return reply.code(401).header('www-authenticate', 'Bearer').send({ error: { code: 'UNAUTHORIZED', message: 'A valid API key is needed: Authorization: Bearer <key>.' } });
    }
    // jobs belong to the key that made them
    /** @type {any} */ (req).owner = hash.toString('hex');
  });

  /**
   * Run the work now, or as a job when the caller asked for one (Prefer: respond-async) or gave
   * a webhook.
   *
   * @param {import('fastify').FastifyRequest} req
   * @param {import('fastify').FastifyReply} reply
   * @param {() => Promise<import('./operations.js').Reply>} work
   * @param {unknown} webhook
   */
  const respond = async (req, reply, work, webhook) => {
    const later = /\brespond-async\b/i.test(String(req.headers.prefer ?? '')) || webhook !== undefined;
    if (!later) return send(reply, await work());
    if (webhook !== undefined) {
      if (!options.webhookSecret) throw new OpenDocumentsError('INVALID_OPTION', 'Webhooks are turned off on this server (OPENDOCS_WEBHOOK_SECRET is not set).');
      await checkWebhook(/** @type {string} */ (webhook), webhookOptions);
    }
    const job = jobs.submit(work, { owner: /** @type {any} */ (req).owner, webhook: /** @type {string | undefined} */ (webhook) });
    const base = `${req.protocol}://${req.headers.host ?? 'localhost'}`;
    resultLinks.set(job.id, `${base}/v1/jobs/${job.id}/result`);
    return reply.code(202).header('location', `/v1/jobs/${job.id}`).send(view(job));
  };

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof OpenDocumentsError) {
      const status = STATUS[/** @type {keyof STATUS} */ (err.code)] ?? 500;
      return reply.code(status).send({ error: { code: err.code, message: err.message } });
    }
    const e = /** @type {any} */ (err);
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'TOO_LARGE', message: `Files may be at most ${Math.round(maxFileSize / 1048576)} MB.` } });
    }
    if (e.code === 'FST_FILES_LIMIT' || e.code === 'FST_PARTS_LIMIT' || e.code === 'FST_FIELDS_LIMIT') {
      return reply.code(413).send({ error: { code: 'TOO_MANY_FILES', message: 'Too many files or fields in one request.' } });
    }
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: 'BAD_REQUEST', message: e.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  });

  app.addHook('onClose', async () => {
    jobs.close();
    if (!options.converter) await converter.close();
    const started = await ocrEngine?.catch(() => null);
    await started?.close();
  });

  app.get('/v1/jobs/:id', async (req, reply) => {
    const entry = jobs.get(/** @type {any} */ (req.params).id, /** @type {any} */ (req).owner);
    if (!entry) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such job. Jobs expire an hour after they finish.' } });
    return view(entry.job);
  });

  app.get('/v1/jobs/:id/result', async (req, reply) => {
    const entry = jobs.get(/** @type {any} */ (req.params).id, /** @type {any} */ (req).owner);
    if (!entry) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such job. Jobs expire an hour after they finish.' } });
    const { job, result } = entry;
    if (job.status === 'failed' && job.error) {
      return reply.code(STATUS[/** @type {keyof STATUS} */ (job.error.code)] ?? 500).send({ error: job.error });
    }
    if (job.status !== 'done' || !result) {
      return reply.code(409).header('retry-after', '1').send({ error: { code: 'NOT_READY', message: `The job is ${job.status}.` } });
    }
    return send(reply, result);
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/v1/operations', async () => ({
    pdf: Object.keys(OPERATIONS),
    convert: ['file', 'html', 'markdown', ...(options.allowUrl ? ['url'] : [])],
  }));

  app.post('/v1/pdf/:operation', async (req, reply) => {
    const name = /** @type {{ operation: string }} */ (req.params).operation;
    const op = OPERATIONS[name];
    if (!op) throw new OpenDocumentsError('INVALID_OPTION', `There is no operation "${name}". GET /v1/operations lists them.`);
    const { files, options: { webhook, ...opts } } = await readForm(req);
    if (!files.length) throw new OpenDocumentsError('INVALID_INPUT', 'Upload the file as multipart form data.');
    if (op.files === 'one' && files.length > 1) throw new OpenDocumentsError('INVALID_INPUT', `${name} takes one file.`);
    return respond(req, reply, () => op.run(files.map((f) => f.data), opts, { converter, ocr }), webhook);
  });

  app.post('/v1/convert', async (req, reply) => {
    const { files, options: opts } = await readForm(req);
    if (files.length !== 1) throw new OpenDocumentsError('INVALID_INPUT', 'Upload one file to convert.');
    const { allowHosts: _a, ports: _p, webhook, ...safe } = opts;
    return respond(req, reply, async () => ({ type: 'application/pdf', body: await converter.toPdf(files[0].data, { ...safe, filename: files[0].filename }) }), webhook);
  });

  app.post('/v1/convert/html', async (req, reply) => {
    if (req.isMultipart()) {
      // index.html plus the files it refers to, by their paths
      const { files, options: { webhook, ...opts } } = await readForm(req);
      const index = files.find((f) => f.filename === 'index.html');
      if (!index) throw new OpenDocumentsError('INVALID_INPUT', 'Upload index.html, with any files it uses next to it.');
      const assets = Object.fromEntries(files.filter((f) => f !== index).map((f) => [f.filename, f.data]));
      return respond(req, reply, async () => ({ type: 'application/pdf', body: await converter.htmlToPdf(new TextDecoder().decode(index.data), { ...opts, assets }) }), webhook);
    }
    const { html, options: { webhook, ...opts } = {} } = /** @type {any} */ (req.body ?? {});
    if (typeof html !== 'string') throw new OpenDocumentsError('INVALID_INPUT', 'Send { "html": "..." } as JSON, or index.html as multipart form data.');
    return respond(req, reply, async () => ({ type: 'application/pdf', body: await converter.htmlToPdf(html, opts) }), webhook);
  });

  app.post('/v1/convert/markdown', async (req, reply) => {
    const { markdown, options: { webhook, ...opts } = {} } = /** @type {any} */ (req.body ?? {});
    if (typeof markdown !== 'string') throw new OpenDocumentsError('INVALID_INPUT', 'Send { "markdown": "..." } as JSON.');
    return respond(req, reply, async () => ({ type: 'application/pdf', body: await converter.markdownToPdf(markdown, opts) }), webhook);
  });

  app.post('/v1/convert/url', async (req, reply) => {
    if (!options.allowUrl) {
      return reply.code(403).send({ error: { code: 'URL_DISABLED', message: 'Web page conversion is turned off on this server (OPENDOCS_ALLOW_URL).' } });
    }
    const { url, options: opts = {} } = /** @type {any} */ (req.body ?? {});
    // which private hosts are reachable is the server's decision, never the caller's
    const { allowHosts: _a, ports: _p, webhook, ...safe } = opts;
    return respond(req, reply, async () => ({ type: 'application/pdf', body: await converter.urlToPdf(url, { ...safe, allowHosts: options.allowHosts }) }), webhook);
  });

  return app;
}

/**
 * @param {import('fastify').FastifyRequest} req
 * @returns {Promise<{ files: { filename: string, data: Uint8Array }[], options: Record<string, any> }>}
 */
async function readForm(req) {
  if (!req.isMultipart()) throw new OpenDocumentsError('INVALID_INPUT', 'Send multipart form data: the file, and settings as a JSON "options" field.');
  /** @type {{ filename: string, data: Uint8Array }[]} */
  const files = [];
  /** @type {Record<string, any>} */
  let options = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      files.push({ filename: part.filename, data: new Uint8Array(await part.toBuffer()) });
    } else if (part.fieldname === 'options') {
      try {
        options = JSON.parse(String(part.value));
      } catch {
        throw new OpenDocumentsError('INVALID_OPTION', 'The options field must be JSON.');
      }
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new OpenDocumentsError('INVALID_OPTION', 'The options field must be a JSON object.');
    }
  }
  return { files, options };
}

/** @param {import('./jobs.js').Job} job */
function view(job) {
  return {
    id: job.id,
    status: job.status,
    created: job.created,
    finished: job.finished,
    error: job.error,
    webhook: job.webhook && { status: job.webhook.status, attempts: job.webhook.attempts },
    links: { self: `/v1/jobs/${job.id}`, result: `/v1/jobs/${job.id}/result` },
  };
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {import('./operations.js').Reply} result
 */
function send(reply, result) {
  reply.type(result.type);
  if (result.type === 'application/json' || typeof result.body === 'string') return reply.send(result.body);
  return reply.send(Buffer.from(/** @type {Uint8Array} */ (result.body)));
}
