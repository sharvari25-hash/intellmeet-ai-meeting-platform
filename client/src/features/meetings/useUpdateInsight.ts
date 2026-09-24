import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MeetingIntelligence, UpdateInsightInput } from '@intellmeet/shared';
import { aiKeys, updateInsight } from './ai.api';

/**
 * Saves the host's corrections to the summary, decisions or action items.
 *
 * The server answers with the whole updated intelligence, which replaces the
 * cached copy directly - no refetch, so the page never flickers back to the
 * old text. History rows show a preview of the summary and the open action
 * item count, so the lists are marked stale to pick the change up.
 */
export function useUpdateInsight(
  meetingId: string,
): UseMutationResult<MeetingIntelligence, Error, UpdateInsightInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateInsightInput) => updateInsight(meetingId, input),
    onSuccess: (intelligence) => {
      queryClient.setQueryData(aiKeys.intelligence(meetingId), intelligence);
      void queryClient.invalidateQueries({
        predicate: ({ queryKey: [root, params] }) =>
          root === 'meetings' && typeof params === 'object' && params !== null,
      });
      toast.success('Saved');
    },
  });
}
