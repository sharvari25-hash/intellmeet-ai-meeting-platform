import type { RequestHandler } from 'express';
import { getIceServers } from './rtc.service.js';

export const iceServers: RequestHandler = (_req, res) => {
  // Short cache: TURN credentials from a provider are time-limited, and a
  // stale list produces connection failures that are painful to diagnose.
  res.set('Cache-Control', 'private, max-age=60');
  res.json(getIceServers());
};
