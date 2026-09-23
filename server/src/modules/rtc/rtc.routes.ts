import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as controller from './rtc.controller.js';

export const rtcRouter: Router = Router();

/**
 * GET /api/rtc/ice-servers
 *
 * Authenticated: a TURN credential is a relay somebody pays for, so it is not
 * handed to anonymous callers.
 */
rtcRouter.get('/ice-servers', requireAuth, controller.iceServers);
