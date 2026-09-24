import path from 'node:path';
import type { RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
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

export const audio: RequestHandler = async (req, res, next) => {
  const source = await recordingService.getRecordingAudio(param(req, 'id'), currentUser(req).id);

  if (source.kind === 'remote') {
    res.redirect(302, source.url);
    return;
  }

  // sendFile handles Range requests, so an <audio> element can seek.
  //
  // Served by file name under `root`, not by absolute path: `send` refuses any
  // path with a dot-segment, and the default directory is `.data/recordings`,
  // so the absolute path answered "Not Found" for every recording. With
  // `root`, only the file name is checked - and that is already pinned to
  // `<meetingId>-<timestamp>.<ext>` by the storage module.
  //
  // The type goes in `headers`, which apply only once the file is found; set
  // up front, it would also label a JSON error body as audio.
  res.sendFile(
    path.basename(source.path),
    { root: path.dirname(source.path), headers: { 'Content-Type': source.mimeType } },
    (error) => {
      if (!error || res.headersSent) return;
      // The row outlived the file: Render's disk is wiped on every deploy.
      next(AppError.notFound('The recording file is no longer available'));
    },
  );
};

export const retry: RequestHandler = async (req, res) => {
  const meeting = await recordingService.retryProcessing(param(req, 'id'), currentUser(req).id);
  res.status(202).json({ meeting });
};
