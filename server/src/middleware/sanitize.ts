import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Replaces `req.query` with a new object.
 *
 * Express 5 defines `query` as a getter-only property on the request
 * prototype, so the usual `req.query = value` throws
 * "Cannot set property query of #<IncomingMessage> which has only a getter".
 * The property is `configurable`, so redefining it on the request instance is
 * the supported way to hand later middleware a cleaned object.
 *
 * This is why the project does not use `express-mongo-sanitize` or `hpp`:
 * both assign to `req.query` directly and therefore break on Express 5. The
 * two middlewares below are their equivalents.
 */
function replaceQuery(req: Request, value: unknown): void {
  Object.defineProperty(req, 'query', {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Guards against deeply nested payloads crafted to blow the call stack. */
const MAX_DEPTH = 20;

/**
 * Keys MongoDB would interpret rather than treat as a field name.
 *
 * `$` starts an operator (`{ email: { $ne: null } }` matches any user, which
 * would hand back an authenticated session) and `.` walks a nested path
 * (`{ 'user.role': 'admin' }`). Neither is ever legitimate in user input.
 *
 * The test is "contains", not "starts with", on purpose. Express 5's default
 * `simple` query parser does not build nested objects, so `?role[$ne]=member`
 * arrives as the single flat key `role[$ne]` - a prefix check would wave it
 * straight through.
 */
const UNSAFE_KEY = /[$.]/;

/** Keys that would let an attacker reach `Object.prototype`. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively rebuilds a value, dropping any key MongoDB could interpret.
 *
 * Removing the key outright is safer than escaping it: an escaped operator is
 * still a decision about what the caller meant, whereas a missing field simply
 * fails validation downstream.
 */
function stripOperatorKeys(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => stripOperatorKeys(item, depth + 1));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (UNSAFE_KEY.test(key) || PROTOTYPE_KEYS.has(key)) continue;
      result[key] = stripOperatorKeys(item, depth + 1);
    }
    return result;
  }

  return value;
}

/**
 * NoSQL-injection guard. Equivalent to `express-mongo-sanitize`, but written
 * against Express 5's read-only `req.query`.
 */
export function mongoSanitize(req: Request, _res: Response, next: NextFunction): void {
  if (req.body !== undefined) req.body = stripOperatorKeys(req.body);
  if (isPlainObject(req.params)) req.params = stripOperatorKeys(req.params) as typeof req.params;
  replaceQuery(req, stripOperatorKeys(req.query));
  next();
}

export interface ParameterPollutionOptions {
  /** Query keys that are legitimately repeatable, e.g. `?tag=a&tag=b`. */
  whitelist?: string[];
}

/**
 * HTTP Parameter Pollution guard. Equivalent to `hpp`.
 *
 * `?role=member&role=admin` parses to `role: ['member', 'admin']`. Handlers
 * and zod schemas expecting a string then behave unpredictably, and validation
 * written for the first value can be bypassed by appending a second. Collapsing
 * to the last value gives every handler a predictable scalar.
 *
 * Only the query string is processed. `hpp` also checks the body, but only for
 * `application/x-www-form-urlencoded` payloads - and this API parses JSON only,
 * where arrays are a legitimate, expected type.
 */
export function preventParameterPollution(options: ParameterPollutionOptions = {}): RequestHandler {
  const whitelist = new Set(options.whitelist ?? []);

  return (req, _res, next) => {
    const query = req.query;
    if (!isPlainObject(query)) {
      next();
      return;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(query)) {
      result[key] = Array.isArray(value) && !whitelist.has(key) ? value.at(-1) : value;
    }

    replaceQuery(req, result);
    next();
  };
}

// Exported for direct use by the validate middleware, which also needs to hand
// a parsed object back through the read-only `req.query` property.
export { replaceQuery };
