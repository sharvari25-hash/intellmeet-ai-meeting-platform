export {};

/**
 * Types the per-request correlation id set by the `requestId` middleware, so
 * `req.id` is a `string` everywhere instead of needing a cast at each use.
 *
 * The augmentation targets `express-serve-static-core`'s `Request` interface
 * rather than the `Express.Request` global. `Request` extends both
 * `Express.Request` and Node's `http.IncomingMessage`, and `pino-http` already
 * declares `id: ReqId` (`number | string | object`) on `IncomingMessage`. When
 * two base interfaces disagree, TypeScript resolves to the first one, so an
 * `Express.Request` augmentation would silently lose to pino's. Declaring the
 * property directly on `Request` shadows the inherited one.
 */
declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}
