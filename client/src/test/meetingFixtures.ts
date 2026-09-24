import { vi } from 'vitest';
import type {
  ChatMessage,
  Meeting,
  MeetingIntelligence,
  UpdateInsightInput,
} from '@intellmeet/shared';
import { authPayload } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';

/**
 * A realistic meeting and its AI output, plus a fake API that serves them -
 * shared by the meeting page's tests. Test-only; never imported by the app.
 */

export const MEETING_ID = '507f1f77bcf86cd799439011';
export const HOST_ID = '507f1f77bcf86cd799439013';
export const GRACE_ID = '507f1f77bcf86cd799439014';

export function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    teamId: '507f1f77bcf86cd799439012',
    title: 'Sprint 14 planning',
    description: null,
    hostId: HOST_ID,
    hostName: 'Demo User',
    status: 'ended',
    roomCode: 'ABC2345',
    scheduledAt: null,
    startedAt: '2026-09-14T09:30:00.000Z',
    endedAt: '2026-09-14T09:51:00.000Z',
    durationSec: 1260,
    participants: [
      { userId: HOST_ID, name: 'Demo User', avatarUrl: null, joinedAt: '', leftAt: null },
      { userId: GRACE_ID, name: 'Grace Hopper', avatarUrl: null, joinedAt: '', leftAt: null },
    ],
    recording: null,
    aiStatus: 'done',
    isHost: true,
    createdAt: '2026-09-14T09:30:00.000Z',
    ...overrides,
  };
}

export function intelligence(overrides: Partial<MeetingIntelligence> = {}): MeetingIntelligence {
  return {
    meetingId: MEETING_ID,
    aiStatus: 'done',
    aiError: null,
    transcript: {
      meetingId: MEETING_ID,
      text: 'Grace, can you fix the upload bug by Friday? Decision: Google Calendar only.',
      segments: [
        {
          start: 67,
          end: 78,
          text: 'Grace, can you fix the upload bug by Friday?',
          speaker: 'Demo User',
        },
        {
          start: 113,
          end: 128,
          text: 'We go with Google Calendar only this sprint.',
          speaker: 'Demo User',
        },
      ],
      language: 'en',
      provider: 'mock',
      createdAt: '2026-09-14T10:00:00.000Z',
    },
    insight: {
      meetingId: MEETING_ID,
      summary: 'The team planned sprint 14.',
      keyDecisions: ['Build Google Calendar only this sprint'],
      actionItems: [
        {
          id: 'a1',
          text: 'Fix the upload retry bug',
          assigneeName: 'Grace Hopper',
          assigneeId: GRACE_ID,
          dueDate: '2026-09-18',
          status: 'open',
          taskId: null,
        },
        {
          id: 'a2',
          text: 'Call the vendor',
          assigneeName: 'Sam',
          assigneeId: null,
          dueDate: null,
          status: 'open',
          taskId: null,
        },
      ],
      provider: 'mock',
      createdAt: '2026-09-14T10:00:00.000Z',
      editedAt: null,
      editedByName: null,
    },
    ...overrides,
  };
}

export function chatMessage(id: string, text: string, createdAt: string): ChatMessage {
  return {
    id: id.padStart(24, '0'),
    meetingId: MEETING_ID,
    senderId: GRACE_ID,
    senderName: 'Grace Hopper',
    senderAvatarUrl: null,
    text,
    createdAt,
  };
}

interface FakeApi {
  meeting?: Partial<Meeting>;
  intelligence?: MeetingIntelligence;
  /** Chat pages, newest first, as the API returns them. */
  chatPages?: { messages: ChatMessage[]; nextCursor: string | null }[];
}

/**
 * Signs a user in and stubs `fetch` with a small in-memory API. A PATCH to
 * the insight is applied to the served intelligence, the way the server
 * would, so the page re-renders with the saved result.
 */
export function serveMeeting(api: FakeApi = {}) {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 't',
  });

  let current = api.intelligence ?? intelligence();
  const pages = api.chatPages ?? [{ messages: [], nextCursor: null }];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (url.endsWith('/intelligence')) return Response.json(current);

    if (url.endsWith('/insight') && method === 'PATCH') {
      const input = JSON.parse(String(init?.body)) as UpdateInsightInput;
      const insight = current.insight;
      if (!insight) return Response.json({}, { status: 404 });
      current = {
        ...current,
        insight: {
          ...insight,
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.keyDecisions ? { keyDecisions: input.keyDecisions } : {}),
          ...(input.actionItems
            ? {
                actionItems: input.actionItems.map((item, index) => ({
                  id: item.id ?? `new-${index}`,
                  text: item.text,
                  assigneeId: item.assigneeId,
                  assigneeName: item.assigneeId === GRACE_ID ? 'Grace Hopper' : item.assigneeName,
                  dueDate: item.dueDate,
                  status: item.status,
                  taskId: null,
                })),
              }
            : {}),
          editedAt: '2026-09-15T08:00:00.000Z',
          editedByName: 'Demo User',
        },
      };
      return Response.json(current);
    }

    if (url.includes('/messages')) {
      const before = new URL(url, 'http://localhost').searchParams.get('before');
      const index = before ? pages.findIndex((_, i) => pages[i - 1]?.nextCursor === before) : 0;
      return Response.json(pages[Math.max(0, index)]);
    }

    if (url.endsWith('/recording/audio')) {
      return new Response(new Blob(['fake audio'], { type: 'audio/webm' }));
    }

    if (url.endsWith('/ai/retry')) {
      return Response.json({ meeting: meeting({ aiStatus: 'queued' }) });
    }

    return Response.json({ meeting: meeting(api.meeting) });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The body of the last PATCH to the insight, parsed. */
export function lastInsightPatch(fetchMock: ReturnType<typeof serveMeeting>): UpdateInsightInput {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([url, init]) => String(url).endsWith('/insight') && init?.method === 'PATCH');
  if (!call) throw new Error('No PATCH to the insight was made');
  return JSON.parse(String(call[1]?.body)) as UpdateInsightInput;
}
