import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Mentionable } from '@intellmeet/shared';
import { getTeam, teamKeys } from '@/features/teams/teams.api';
import { useAuthStore } from '@/stores/authStore';

/**
 * The people who can be mentioned in a team's conversations: its members,
 * less the person typing (mentioning yourself notifies nobody). Shares the
 * team query the team pages use, so it is usually already cached.
 */
export function useTeamPeople(teamId: string | undefined): Mentionable[] {
  const selfId = useAuthStore((state) => state.user?.id);
  const team = useQuery({
    queryKey: teamKeys.detail(teamId ?? ''),
    queryFn: () => getTeam(teamId ?? ''),
    enabled: Boolean(teamId),
    staleTime: 60_000,
  });

  return useMemo(
    () =>
      (team.data?.members ?? [])
        .filter((member) => member.userId !== selfId)
        .map((member) => ({ id: member.userId, name: member.name })),
    [team.data, selfId],
  );
}
