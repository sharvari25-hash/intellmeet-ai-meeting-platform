import { Router } from 'express';
import {
  loginSchema,
  registerSchema,
  requestLoginCodeSchema,
  verifyLoginCodeSchema,
} from '@intellmeet/shared';
import {
  accountLoginLimiter,
  authLimiter,
  codeCooldownLimiter,
  codeEmailLimiter,
  codeRequestLimiter,
  codeVerifyLimiter,
  demoLimiter,
  emailDailyLimiter,
  loginLimiter,
  refreshLimiter,
} from '../../middleware/rateLimit.js';
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

// Three limiters: the per-IP one caps total attempts from one source, the
// per-IP+email one stops credential stuffing against a single account, and
// the per-account one holds even for a caller who can choose its address.
authRouter.post(
  '/login',
  authLimiter,
  loginLimiter,
  accountLoginLimiter,
  validate({ body: loginSchema }),
  controller.login,
);

// Sign in or sign up with an emailed code. Asking for a code can cost an email,
// so the limits come in layers: the caller's address first (before parsing),
// then validation, then the limits that need the address in the body - one
// code a minute and five a quarter-hour per address, then the whole server's
// daily ceiling last, so malformed requests and repeats never spend it.
authRouter.post(
  '/code',
  codeRequestLimiter,
  validate({ body: requestLoginCodeSchema }),
  codeCooldownLimiter,
  codeEmailLimiter,
  emailDailyLimiter,
  controller.requestCode,
);
// Spends the code. No hashing, so cheap; bounded by the code's own attempt
// counter, and per caller and address here.
authRouter.post(
  '/code/verify',
  codeVerifyLimiter,
  validate({ body: verifyLoginCodeSchema }),
  controller.verifyCode,
);

// Creates a guest per call. Its own per-IP budget, sized for a room of
// reviewers behind one NAT; the guest ceiling (DEMO_MAX_GUESTS) bounds what
// many addresses together can create.
authRouter.post('/demo', demoLimiter, controller.demoLogin);
// Ends a guest's demo session and deletes the guest. Bearer-authenticated, and
// only ever acts on the caller's own account.
authRouter.delete('/demo', requireAuth, controller.endDemo);
// Every page load refreshes, so this budget is the generous one.
authRouter.post('/refresh', refreshLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);

authRouter.get('/me', requireAuth, controller.me);
