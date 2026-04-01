#!/usr/bin/env node
// Start the API. Settings come from the environment; see the server's README.
import { buildServer } from '../src/app.js';
import { configFromEnv } from '../src/config.js';

let config;
try {
  config = configFromEnv(process.env);
} catch (err) {
  console.error(`opendocs-server: ${/** @type {Error} */ (err).message}`);
  process.exit(2);
}
const app = await buildServer(config.server);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
await app.listen({ host: config.host, port: config.port });
