import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Paths scrubbed from every log line.
 *
 * Working rule: never log secrets. Redaction is configured once, here, rather
 * than relying on each call site to remember - a forgotten `logger.info(user)`
 * would otherwise leak a password hash or a refresh token.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  // AI provider and Cloudinary credentials (Phase 6). Nothing logs them on
  // purpose; this catches the accidental `logger.debug({ config })`.
  'apiKey',
  'apiSecret',
  '*.apiKey',
  '*.apiSecret',
  '*.authorization',
  '*["x-goog-api-key"]',
];

/**
 * Pretty, colourised output in local development; newline-delimited JSON in
 * production and CI so Render/Grafana can parse it. The pretty transport is
 * skipped under test because it spawns a worker thread that would keep Vitest
 * alive after the suite finishes.
 */
const usePrettyTransport = !isProduction && !isTest;

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'intellmeet-server' },
  ...(usePrettyTransport
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
