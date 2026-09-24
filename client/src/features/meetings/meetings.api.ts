import { z } from 'zod';
import {
  meetingListSchema,
  meetingSchema,
  messageHistorySchema,
  type CreateMeetingInput,
  type Meeting,
  type MeetingList,
  type MeetingStatus,
  type MessageHistory,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const meetingResponseSchema = z.object({ meeting: meetingSchema });

/** What the meeting history can be narrowed by. Every field is optional. */
export interface MeetingListParams {
  teamId?: string;
  status?: MeetingStatus;
  q?: string;
  page?: number;
  limit?: number;
}

/**
 * Query keys. Every list key is `['meetings', {params}]` - an object in second
 * place - which is how `useAiStatusUpdates` recognises a list to refresh when
 * a summary finishes.
 */
export const meetingKeys = {
  all: ['meetings'] as const,
  list: (teamId?: string) => ['meetings', { teamId: teamId ?? null }] as const,
  history: (params: MeetingListParams) =>
    [
      'meetings',
      {
        teamId: params.teamId ?? null,
        status: params.status ?? null,
        q: params.q ?? '',
        page: params.page ?? 1,
        view: 'history',
      },
    ] as const,
  byCode: (roomCode: string) => ['meetings', 'code', roomCode] as const,
  detail: (meetingId: string) => ['meetings', 'detail', meetingId] as const,
};

export function listMeetings(params: MeetingListParams = {}): Promise<MeetingList> {
  const search = new URLSearchParams();
  if (params.teamId) search.set('teamId', params.teamId);
  if (params.status) search.set('status', params.status);
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.page && params.page > 1) search.set('page', String(params.page));
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
  /**
   * The meeting page's paged chat log. A key of its own: it is an infinite
   * query, whose cached shape differs from the room's single page.
   */
  log: (meetingId: string) => ['meetings', meetingId, 'messages', 'log'] as const,
};

/**
 * A page of chat, newest page first.
 *
 * Without `before` it is the most recent page: somebody joining a meeting in
 * progress wants the last few exchanges for context, not an hour of
 * scrollback. The meeting page passes `before` to read further back.
 */
export function getMessageHistory(meetingId: string, before?: string): Promise<MessageHistory> {
  const search = new URLSearchParams({ limit: '50' });
  if (before) search.set('before', before);
  return api(`/meetings/${meetingId}/messages?${search.toString()}`, messageHistorySchema);
}
