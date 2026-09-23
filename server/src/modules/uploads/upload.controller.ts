import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import { createUploadSignature } from './upload.service.js';

export const getSignature: RequestHandler = (req, res) => {
  const { kind } = req.query as { kind: 'avatar' | 'recording' };
  res.json(createUploadSignature(kind, currentUser(req).id));
};
