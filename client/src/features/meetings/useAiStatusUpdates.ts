import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { SOCKET_EVENTS, type AiStatusEvent } from '@intellmeet/shared';
import { useSocketStore } from '@/stores/socketStore';

/**
 * Refreshes meeting data whenever the AI pipeline moves a step.
 *
 * The server pushes `ai:status` to the whole team, so a page showing a
 * meeting's progress - the dashboard list, the meeting page - updates from
 * "Transcribing" to "Summarizing" to "Done" without polling.
 *
 * Refetching rather than patching the cache keeps the server the only source
 * of truth, and it is one small request per step. Only the three kinds of
 * query that show AI state are touched: chat history is expensive and
 * unrelated, and the room's by-code lookup answers 409 once a meeting has
 * ended - refetching it would replace the "meeting has ended" screen with an
 * error at exactly the moment the recording starts processing.
 */
function showsAiState(queryKey: readonly unknown[]): boolean {
  const [root, second, third] = queryKey;
  if (root !== 'meetings') return false;
  // ['meetings', { teamId }] - the lists.
  if (typeof second === 'object' && second !== null) return true;
  return second === 'detail' || third === 'intelligence';
}

/** Refetches every query that displays AI pipeline state, and nothing else. */
export function invalidateAiQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (query) => showsAiState(query.queryKey) });
}
export function useAiStatusUpdates(onStatus?: (event: AiStatusEvent) => void): void {
  const socket = useSocketStore((state) => state.socket);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    const handler = (raw: unknown) => {
      const event = raw as AiStatusEvent;
      void invalidateAiQueries(queryClient);
      onStatus?.(event);
    };

    socket.on(SOCKET_EVENTS.AI_STATUS, handler);
    return () => {
      socket.off(SOCKET_EVENTS.AI_STATUS, handler);
    };
  }, [socket, queryClient, onStatus]);
}
