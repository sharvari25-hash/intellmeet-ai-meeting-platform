import cors from 'cors';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { REQUEST_ID_HEADER } from './requestId.js';

/**
 * Strict origin allowlist driven by `CORS_ORIGINS`.
 *
 * `credentials: true` is required for the refresh-token cookie, and the CORS
 * spec forbids pairing credentials with a `*` origin - so an allowlist is not
 * optional here, it is the only thing that works.
 *
 * Requests with no `Origin` header (curl, server-to-server, same-origin
 * navigations) are allowed through: CORS is a browser mechanism, and blocking
 * them would break Render's health check without adding any security.
 */
export const corsMiddleware: RequestHandler = cors({
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(AppError.forbidden(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER],
  exposedHeaders: [REQUEST_ID_HEADER],
  // Cache the preflight for a day to cut an extra round trip per request.
  maxAge: 86_400,
});
