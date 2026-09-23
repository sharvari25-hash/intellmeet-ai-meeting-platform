import type { RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { getMeetingIntelligence } from '../ai/ai.service.js';
import * as recordingService from './recording.service.js';

export const uploadTarget: RequestHandler = async (req, res) => {
  res.json(await recordingService.getUploadTarget(param(req, 'id'), currentUser(req).id));
};

export const saveCloudinary: RequestHandler = async (req, res) => {
  const meeting = await recordingService.saveCloudinaryRecording(
    param(req, 'id'),
    currentUser(req).id,
    req.body,
  );
  res.status(202).json({ meeting });
};

export const uploadFile: RequestHandler = async (req, res) => {
  // `express.raw` leaves the body untouched (an empty object) when the
  // Content-Type is not one it was told to accept.
  if (
    !Buffer.isBuffer(req.body) ||
    !recordingService.isAcceptedRecordingType(req.headers['content-type'])
  ) {
    throw AppError.badRequest('Send the recording as audio/webm, audio/ogg or audio/mp4');
  }

  const { durationSec } = req.query as unknown as { durationSec: number };

  const meeting = await recordingService.saveUploadedRecording(
    param(req, 'id'),
    currentUser(req).id,
    {
      data: req.body,
      contentType: req.headers['content-type'] ?? 'audio/webm',
      durationSec,
    },
  );

  // 202: the recording is stored, but the work it triggers is still running.
  res.status(202).json({ meeting });
};

export const audio: RequestHandler = async (req, res) => {
  const source = await recordingService.getRecordingAudio(param(req, 'id'), currentUser(req).id);

  if (source.kind === 'remote') {
    res.redirect(302, source.url);
    return;
  }

  res.type(source.mimeType);
  // sendFile handles Range requests, so an <audio> element can seek.
  res.sendFile(source.path);
};

export const intelligence: RequestHandler = async (req, res) => {
  res.json(await getMeetingIntelligence(param(req, 'id'), currentUser(req).id));
};

export const retry: RequestHandler = async (req, res) => {
  const meeting = await recordingService.retryProcessing(param(req, 'id'), currentUser(req).id);
  res.status(202).json({ meeting });
};
