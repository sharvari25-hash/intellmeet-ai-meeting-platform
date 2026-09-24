import { Router } from 'express';
import { loginSchema, registerSchema } from '@intellmeet/shared';
import { authLimiter, loginLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';

/**
 * Auth routes.
 *
 * Handlers are plain `async` functions with no try/catch wrapper: Express 5
 * forwards a rejected promise from a handler to the error middleware
 * automatically, which Express 4 did not. That is why there is no
 * `asyncHandler` helper anywhere in this codebase.
 *
 * Order within each route matters - rate limit first (so a flood is rejected
 * before any parsing or hashing work), then validation, then the handler.
 */
export const authRouter: Router = Router();

authRouter.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);

// Both limiters: the per-IP+email one stops credential stuffing against a
// single account, the per-IP one caps total attempts from one source.
authRouter.post(
  '/login',
  authLimiter,
  loginLimiter,
  validate({ body: loginSchema }),
  controller.login,
);

// Creates a guest per call, so it shares the tighter auth limiter; the guest
// ceiling (DEMO_MAX_GUESTS) bounds what many addresses together can create.
authRouter.post('/demo', authLimiter, controller.demoLogin);
// Ends a guest's demo session and deletes the guest. Bearer-authenticated, and
// only ever acts on the caller's own account.
authRouter.delete('/demo', requireAuth, controller.endDemo);
authRouter.post('/refresh', authLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);

authRouter.get('/me', requireAuth, controller.me);
