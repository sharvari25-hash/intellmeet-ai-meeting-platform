import { describe, expect, it } from 'vitest';
import type { Notification } from '@intellmeet/shared';
import { notificationLink } from './notificationLink';

const base: Notification = {
  id: '507f1f77bcf86cd799439011',
  type: 'summary_ready',
  title: 't',
  body: 'b',
  payload: {},
  readAt: null,
  createdAt: new Date().toISOString(),
};

describe('notificationLink', () => {
  it('opens the meeting page for a finished summary', () => {
    expect(notificationLink({ ...base, payload: { meetingId: 'abc' } })).toBe('/app/meetings/abc');
  });

  it('opens the room for a meeting that just started', () => {
    expect(
      notificationLink({ ...base, type: 'meeting_started', payload: { roomCode: 'ABC2345' } }),
    ).toBe('/app/room/ABC2345');
  });

  it('opens the task on its board for an assignment or a comment mention', () => {
    const payload = { taskId: 't1', boardId: 'b1', teamId: 'team' };
    expect(notificationLink({ ...base, type: 'task_assigned', payload })).toBe(
      '/app/tasks?board=b1&task=t1',
    );
    expect(notificationLink({ ...base, type: 'mention', payload })).toBe(
      '/app/tasks?board=b1&task=t1',
    );
  });

  it('opens the chat log for a mention in a meeting’s chat', () => {
    expect(
      notificationLink({
        ...base,
        type: 'mention',
        payload: { meetingId: 'abc', roomCode: 'ABC2345', messageId: 'm' },
      }),
    ).toBe('/app/meetings/abc?tab=chat');
  });

  it('goes nowhere when the payload is missing or malformed', () => {
    expect(notificationLink(base)).toBeNull();
    expect(notificationLink({ ...base, payload: { meetingId: 42 } })).toBeNull();
    expect(notificationLink({ ...base, type: 'invite', payload: { meetingId: 'abc' } })).toBeNull();
    expect(
      notificationLink({ ...base, type: 'task_assigned', payload: { taskId: 't1' } }),
    ).toBeNull();
  });
});
