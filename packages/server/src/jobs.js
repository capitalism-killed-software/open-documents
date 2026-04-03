// Work that runs after the request has been answered: `Prefer: respond-async` gets a 202 and a
// job to poll, and optionally a webhook when it is done. Jobs live in memory on this server,
// expire after an hour, and can only be read with the API key that created them.
import { randomUUID } from 'node:crypto';
import { OpenDocumentsError } from '@open-documents/core';

/**
 * @typedef {'queued' | 'running' | 'done' | 'failed'} JobStatus
 * @typedef {object} Job
 * @property {string} id
 * @property {JobStatus} status
 * @property {string} created  ISO time
 * @property {string | null} finished
 * @property {{ code: string, message: string } | null} error
 * @property {{ url: string, status: 'pending' | 'delivered' | 'failed', attempts: number } | null} webhook
 */

/**
 * @param {{ ttl?: number, concurrency?: number, maxJobs?: number, onDone?: (job: Job) => void }} [options]
 */
export function createJobs(options = {}) {
  const ttl = options.ttl ?? 3_600_000;
  const concurrency = options.concurrency ?? 4;
  const maxJobs = options.maxJobs ?? 1000;
  /** @type {Map<string, { job: Job, owner: string, result: import('./operations.js').Reply | null, expires: number }>} */
  const jobs = new Map();
  /** @type {(() => Promise<void>)[]} */
  const queue = [];
  let running = 0;

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of jobs) if (entry.expires < now) jobs.delete(id);
  }, Math.min(ttl, 60_000));
  sweep.unref();

  const pump = () => {
    while (running < concurrency && queue.length) {
      running++;
      const next = /** @type {() => Promise<void>} */ (queue.shift());
      next().finally(() => {
        running--;
        pump();
      });
    }
  };

  return {
    /**
     * @param {() => Promise<import('./operations.js').Reply>} work
     * @param {{ owner: string, webhook?: string }} meta
     * @returns {Job}
     */
    submit(work, meta) {
      if (jobs.size >= maxJobs) throw new OpenDocumentsError('BUSY', 'Too many jobs are waiting. Try again shortly.');
      /** @type {Job} */
      const job = {
        id: randomUUID(),
        status: 'queued',
        created: new Date().toISOString(),
        finished: null,
        error: null,
        webhook: meta.webhook ? { url: meta.webhook, status: 'pending', attempts: 0 } : null,
      };
      const entry = { job, owner: meta.owner, result: /** @type {import('./operations.js').Reply | null} */ (null), expires: Date.now() + ttl };
      jobs.set(job.id, entry);
      queue.push(async () => {
        job.status = 'running';
        try {
          entry.result = await work();
          job.status = 'done';
        } catch (err) {
          job.status = 'failed';
          job.error = err instanceof OpenDocumentsError ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'Something went wrong on the server.' };
        }
        job.finished = new Date().toISOString();
        entry.expires = Date.now() + ttl;
        options.onDone?.(job);
      });
      pump();
      return job;
    },
    /**
     * @param {string} id
     * @param {string} owner
     */
    get(id, owner) {
      const entry = jobs.get(id);
      return entry && entry.owner === owner ? entry : null;
    },
    close() {
      clearInterval(sweep);
      jobs.clear();
    },
  };
}
