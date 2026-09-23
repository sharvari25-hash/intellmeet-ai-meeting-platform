/**
 * Public surface of the shared package.
 *
 * Everything that both the client and the server must agree on lives here:
 * zod schemas (single source of truth for validation) and the TypeScript
 * types inferred from them. Never import client- or server-only code here.
 */
export * from './errors.js';
export * from './health.js';
