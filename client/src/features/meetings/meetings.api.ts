import { z } from 'zod';
import {
  meetingListSchema,
  meetingSchema,
  messageHistorySchema,
  type CreateMeetingInput,
  type Meeting,
  type MeetingList,
  type MessageHistory,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const meetingResponseSchema = z.object({ meeting: meetingSchema });

export const meetingKeys = {
  all: ['meetings'] as const,
  list: (teamId?: string) => ['meetings', { teamId: teamId ?? null }] as const,
  byCode: (roomCode: string) => ['meetings', 'code', roomCode] as const,
  detail: (meetingId: string) => ['meetings', 'detail', meetingId] as const,
};

export function listMeetings(
  params: { teamId?: string; limit?: number } = {},
): Promise<MeetingList> {
  const search = new URLSearchParams();
  if (params.teamId) search.set('teamId', params.teamId);
  if (params.limit) search.set('limit', String(params.limit));

  const query = search.toString();
  return api(`/meetings${query ? `?${query}` : ''}`, meetingListSchema);
}

/**
 * Creates a meeting.
 *
 * Omitting `scheduledAt` is what makes it start immediately - the server
 * treats its absence as "start now" and returns a meeting already live, which
 * is also what triggers the meeting_started notification.
 */
export function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  return api('/meetings', meetingResponseSchema, { method: 'POST', body: input }).then(
    (result) => result.meeting,
  );
}

export function getMeetingByCode(roomCode: string): Promise<Meeting> {
  return api(`/meetings/code/${roomCode}`, meetingResponseSchema).then((result) => result.meeting);
}

export function getMeeting(meetingId: string): Promise<Meeting> {
  return api(`/meetings/${meetingId}`, meetingResponseSchema).then((result) => result.meeting);
}

export function endMeeting(meetingId: string): Promise<Meeting> {
  return api(`/meetings/${meetingId}/end`, meetingResponseSchema, { method: 'POST' }).then(
    (result) => result.meeting,
  );
}

export const messageKeys = {
  history: (meetingId: string) => ['meetings', meetingId, 'messages'] as const,
};

/**
 * The chat that happened before we arrived.
 *
 * Only the most recent page: somebody joining a meeting in progress wants the
 * last few exchanges for context, not an hour of scrollback, and the cursor is
 * there if they do.
 */
export function getMessageHistory(meetingId: string): Promise<MessageHistory> {
  return api(`/meetings/${meetingId}/messages?limit=50`, messageHistorySchema);
}
