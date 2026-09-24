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

  it('goes nowhere when the payload is missing or malformed', () => {
    expect(notificationLink(base)).toBeNull();
    expect(notificationLink({ ...base, payload: { meetingId: 42 } })).toBeNull();
    expect(notificationLink({ ...base, type: 'invite', payload: { meetingId: 'abc' } })).toBeNull();
  });
});
