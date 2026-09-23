import type { UserRole } from '@intellmeet/shared';

export {};

/**
 * Augments Express's request with the two things our middleware attaches.
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
    /** Correlation id set by the `requestId` middleware. */
    id: string;
    /**
     * Set by `requireAuth`. Optional because it is genuinely absent on public
     * routes - controllers read it through `currentUser(req)`, which turns a
     * missing `requireAuth` into a loud error rather than a silent `undefined`.
     */
    user?: { id: string; role: UserRole };
  }
}
