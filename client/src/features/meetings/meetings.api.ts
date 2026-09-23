import { z } from 'zod';
import {
  meetingListSchema,
  meetingSchema,
  type Meeting,
  type MeetingList,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const meetingResponseSchema = z.object({ meeting: meetingSchema });

export const meetingKeys = {
  all: ['meetings'] as const,
  list: (teamId?: string) => ['meetings', { teamId: teamId ?? null }] as const,
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

/** Creates a meeting that is live immediately - the dashboard's one-click flow. */
export function startInstantMeeting(teamId: string, title: string): Promise<Meeting> {
  return api('/meetings', meetingResponseSchema, {
    method: 'POST',
    body: { teamId, title },
  }).then((result) => result.meeting);
}

export function getMeetingByCode(roomCode: string): Promise<Meeting> {
  return api(`/meetings/code/${roomCode}`, meetingResponseSchema).then((result) => result.meeting);
}
