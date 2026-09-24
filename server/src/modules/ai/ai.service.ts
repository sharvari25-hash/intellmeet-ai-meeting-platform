import {
  meetingInsightSchema,
  meetingIntelligenceSchema,
  transcriptSchema,
  type MeetingIntelligence,
} from '@intellmeet/shared';
import { getMeetingForMember } from '../meetings/meeting.service.js';
import { MeetingInsight, type MeetingInsightDocument } from './insight.model.js';
import { Transcript, type TranscriptDocument } from './transcript.model.js';

function toTranscriptDto(doc: TranscriptDocument) {
  return transcriptSchema.parse({
    meetingId: doc.meetingId.toString(),
    text: doc.text,
    segments: doc.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker ?? null,
    })),
    language: doc.language ?? null,
    provider: doc.provider,
    createdAt: doc.createdAt.toISOString(),
  });
}

function toInsightDto(doc: MeetingInsightDocument) {
  return meetingInsightSchema.parse({
    meetingId: doc.meetingId.toString(),
    summary: doc.summary,
    keyDecisions: doc.keyDecisions,
    actionItems: doc.actionItems.map((item) => ({
      text: item.text,
      assigneeName: item.assigneeName ?? null,
      assigneeId: item.assigneeId ? item.assigneeId.toString() : null,
      dueDate: item.dueDate ?? null,
      status: item.status ?? 'open',
      taskId: item.taskId ? item.taskId.toString() : null,
    })),
    provider: doc.provider,
    createdAt: doc.createdAt.toISOString(),
  });
}

/**
 * The AI side of a meeting: status, transcript and insight together.
 *
 * One request rather than three, because the meeting page always wants all of
 * them at once, and re-fetches the lot whenever an `ai:status` event arrives.
 */
export async function getMeetingIntelligence(
  meetingId: string,
  userId: string,
): Promise<MeetingIntelligence> {
  const meeting = await getMeetingForMember(meetingId, userId);

  const [transcript, insight] = await Promise.all([
    Transcript.findOne({ meetingId: meeting._id }),
    MeetingInsight.findOne({ meetingId: meeting._id }),
  ]);

  return meetingIntelligenceSchema.parse({
    meetingId: meeting._id.toString(),
    aiStatus: meeting.aiStatus,
    aiError: meeting.aiError ?? null,
    transcript: transcript ? toTranscriptDto(transcript) : null,
    insight: insight ? toInsightDto(insight) : null,
  });
}
