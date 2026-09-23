import { createApp } from './app.js';
import { env } from './config/env.js';

/**
 * Process entry point: owns the HTTP listener and the process lifecycle.
 * Graceful shutdown of Mongo/Redis/Socket.io is added in Phase 1.
 */
const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`[server] health: http://localhost:${env.PORT}/api/health`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, closing HTTP server`);
    server.close(() => process.exit(0));
  });
}
