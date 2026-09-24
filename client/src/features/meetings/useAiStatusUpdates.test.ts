import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateAiQueries } from './useAiStatusUpdates';

describe('invalidateAiQueries', () => {
  it('refreshes what shows AI state, and leaves the room and chat alone', async () => {
    const client = new QueryClient();
    const keys = {
      list: ['meetings', { teamId: null }],
      detail: ['meetings', 'detail', 'm1'],
      intelligence: ['meetings', 'm1', 'intelligence'],
      // Refetching this for an ended meeting returns 409 and would replace
      // the "meeting has ended" screen with an error.
      byCode: ['meetings', 'code', 'ABC2345'],
      chat: ['meetings', 'm1', 'messages'],
      teams: ['teams'],
    };
    for (const key of Object.values(keys)) client.setQueryData(key, {});

    await invalidateAiQueries(client);

    const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(keys.list)).toBe(true);
    expect(stale(keys.detail)).toBe(true);
    expect(stale(keys.intelligence)).toBe(true);
    expect(stale(keys.byCode)).toBe(false);
    expect(stale(keys.chat)).toBe(false);
    expect(stale(keys.teams)).toBe(false);
  });
});
