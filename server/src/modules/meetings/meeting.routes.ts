import express, { Router } from 'express';
import {
  createMeetingSchema,
  idParamsSchema,
  listMeetingsQuerySchema,
  messageHistoryQuerySchema,
  recordingFileQuerySchema,
  roomCodeParamsSchema,
  saveRecordingSchema,
  updateMeetingSchema,
} from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as recordings from '../recordings/recording.controller.js';
import { isAcceptedRecordingType } from '../recordings/recording.service.js';
import * as controller from './meeting.controller.js';

export const meetingRouter: Router = Router();

// No anonymous meeting operations: even joining by code requires an account,
// because a room code is a convenience for people who already have access,
// not a capability that grants it.
meetingRouter.use(requireAuth);

meetingRouter.post('/', writeLimiter, validate({ body: createMeetingSchema }), controller.create);
meetingRouter.get('/', validate({ query: listMeetingsQuerySchema }), controller.list);

// Declared before '/:id' so the literal segment is not swallowed by the param.
meetingRouter.get(
  '/code/:roomCode',
  validate({ params: roomCodeParamsSchema }),
  controller.getByCode,
);

meetingRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);

meetingRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateMeetingSchema }),
  controller.update,
);

meetingRouter.delete('/:id', validate({ params: idParamsSchema }), controller.remove);

meetingRouter.post('/:id/start', validate({ params: idParamsSchema }), controller.start);
meetingRouter.post('/:id/end', validate({ params: idParamsSchema }), controller.end);

meetingRouter.get(
  '/:id/messages',
  validate({ params: idParamsSchema, query: messageHistoryQuerySchema }),
  controller.messages,
);

// --- Recording and AI (Phase 6) --------------------------------------------

/** Where the host's browser should upload a finished recording. */
meetingRouter.get(
  '/:id/recording/upload-target',
  validate({ params: idParamsSchema }),
  recordings.uploadTarget,
);

/** Registers a recording uploaded to Cloudinary, and queues the AI job. */
meetingRouter.post(
  '/:id/recording',
  writeLimiter,
  validate({ params: idParamsSchema, body: saveRecordingSchema }),
  recordings.saveCloudinary,
);

/**
 * The no-Cloudinary path: the audio itself, as the raw request body.
 *
 * A raw body rather than multipart: the browser already holds a single Blob,
 * and this avoids a multipart parser dependency for one endpoint. The global
 * JSON parser's 1 MB cap does not apply - it only parses JSON - so this route
 * sets its own ceiling.
 */
meetingRouter.put(
  '/:id/recording/file',
  writeLimiter,
  validate({ params: idParamsSchema, query: recordingFileQuerySchema }),
  express.raw({
    type: (req) => isAcceptedRecordingType(req.headers['content-type']),
    limit: `${env.MAX_RECORDING_MB}mb`,
  }),
  recordings.uploadFile,
);

meetingRouter.get('/:id/recording/audio', validate({ params: idParamsSchema }), recordings.audio);

/** Status, transcript and insight in one response. */
meetingRouter.get(
  '/:id/intelligence',
  validate({ params: idParamsSchema }),
  recordings.intelligence,
);

meetingRouter.post(
  '/:id/ai/retry',
  writeLimiter,
  validate({ params: idParamsSchema }),
  recordings.retry,
);
