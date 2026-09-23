import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const segmentSchema = new Schema(
  {
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    text: { type: String, required: true },
    speaker: { type: String, default: null },
  },
  { _id: false },
);

/**
 * What was said in a meeting.
 *
 * A collection of its own rather than a field on the meeting: an hour of
 * speech is tens of kilobytes, and every meeting list and cache entry would
 * otherwise drag it along. One transcript per meeting - a re-run replaces it.
 */
const transcriptSchema = new Schema(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
    text: { type: String, required: true },
    segments: { type: [segmentSchema], default: [] },
    language: { type: String, default: null },
    provider: { type: String, required: true },
  },
  { timestamps: true },
);

// Full-text search over what was said, for the meeting history search in
// Phase 7. Mongo allows one text index per collection, which is why each
// searchable collection carries its own.
//
// `language_override` points at a field that does not exist. By default a text
// index reads a field called `language` as the document's stemming language -
// so `language: null` fails to insert, and so does any language Mongo's text
// search does not support ("tamil"), which is exactly what Whisper returns
// for a Tamil meeting. Found by the demo cleanup tests.
transcriptSchema.index({ text: 'text' }, { language_override: 'textSearchLanguage' });

export type TranscriptDocument = HydratedDocument<InferSchemaType<typeof transcriptSchema>>;

export const Transcript = model('Transcript', transcriptSchema);
