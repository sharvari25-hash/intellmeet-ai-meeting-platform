import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { MeetingIntelligence } from '@intellmeet/shared';
import { authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { MeetingDetailPage } from './MeetingDetailPage';

const MEETING_ID = '507f1f77bcf86cd799439011';

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    id: MEETING_ID,
    teamId: '507f1f77bcf86cd799439012',
    title: 'Sprint 14 planning',
    description: null,
    hostId: '507f1f77bcf86cd799439013',
    hostName: 'Demo User',
    status: 'ended',
    roomCode: 'ABC2345',
    scheduledAt: null,
    startedAt: '2026-09-14T09:30:00.000Z',
    endedAt: '2026-09-14T09:51:00.000Z',
    durationSec: 1260,
    participants: [
      {
        userId: '507f1f77bcf86cd799439013',
        name: 'Demo User',
        avatarUrl: null,
        joinedAt: '',
        leftAt: null,
      },
      {
        userId: '507f1f77bcf86cd799439014',
        name: 'Grace Hopper',
        avatarUrl: null,
        joinedAt: '',
        leftAt: null,
      },
    ],
    recording: null,
    aiStatus: 'done',
    isHost: true,
    createdAt: '2026-09-14T09:30:00.000Z',
    ...overrides,
  };
}

const DONE: MeetingIntelligence = {
  meetingId: MEETING_ID,
  aiStatus: 'done',
  aiError: null,
  transcript: {
    meetingId: MEETING_ID,
    text: 'Grace, can you fix the upload bug by Friday?',
    segments: [
      {
        start: 67,
        end: 78,
        text: 'Grace, can you fix the upload bug by Friday?',
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
        text: 'Fix the upload retry bug',
        assigneeName: 'Grace Hopper',
        assigneeId: '507f1f77bcf86cd799439014',
        dueDate: '2026-09-18',
        status: 'open',
        taskId: null,
      },
      {
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
  },
};

function serve(intelligence: MeetingIntelligence, meetingOverrides: Record<string, unknown> = {}) {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 't',
  });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/intelligence')) return Response.json(intelligence);
    if (url.endsWith('/ai/retry'))
      return Response.json({ meeting: meeting({ aiStatus: 'queued' }) });
    return Response.json({ meeting: meeting(meetingOverrides) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return renderWithProviders(<MeetingDetailPage />, {
    route: `/app/meetings/${MEETING_ID}`,
    path: '/app/meetings/:meetingId',
  });
}

describe('<MeetingDetailPage />', () => {
  it('shows the summary, decisions, owned action items and transcript', async () => {
    serve(DONE);
    renderPage();

    // The first render in the file pays for the whole page tree; a loaded
    // machine can take longer than the default 1s for that alone.
    expect(
      await screen.findByText('The team planned sprint 14.', {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sprint 14 planning' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Build Google Calendar only this sprint')).toBeInTheDocument();

    expect(screen.getByText('Fix the upload retry bug')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText(/Due Fri/)).toBeInTheDocument();

    // A name that matched nobody in the meeting is shown, but flagged.
    expect(screen.getByText(/Sam \(not a participant\)/)).toBeInTheDocument();

    expect(screen.getByText('01:07')).toBeInTheDocument();
    expect(screen.getByText('Grace, can you fix the upload bug by Friday?')).toBeInTheDocument();
  });

  it('walks through the pipeline steps while processing', async () => {
    serve({ ...DONE, aiStatus: 'transcribing', insight: null, transcript: null });
    renderPage();

    const current = await screen.findByText('Transcribing the audio');
    expect(current.closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Recording received').closest('li')).toHaveTextContent('(done)');
  });

  it('explains a failure and lets the host retry', async () => {
    const fetchMock = serve({
      ...DONE,
      aiStatus: 'failed',
      aiError: 'The AI service is rate-limiting requests. Retry in a minute.',
      insight: null,
      transcript: null,
    });
    const { user } = renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('rate-limiting');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/meetings/${MEETING_ID}/ai/retry`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('does not offer Retry to someone who is not the host', async () => {
    serve(
      { ...DONE, aiStatus: 'failed', aiError: 'x', insight: null, transcript: null },
      { isHost: false },
    );
    renderPage();

    expect(await screen.findByText('The host can retry from this page.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('says so when a meeting was never recorded', async () => {
    serve({ ...DONE, aiStatus: 'none', insight: null, transcript: null }, { aiStatus: 'none' });
    renderPage();

    expect(await screen.findByText('No recording')).toBeInTheDocument();
  });
});
