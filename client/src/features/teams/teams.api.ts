import { z } from 'zod';
import {
  teamInviteSchema,
  teamSchema,
  type Team,
  type TeamInvite,
  type TeamRole,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const teamsResponseSchema = z.object({ teams: z.array(teamSchema) });
const teamResponseSchema = z.object({ team: teamSchema });
const inviteResponseSchema = z.object({ invite: teamInviteSchema });

/**
 * Query keys, centralised.
 *
 * Defining them here rather than inline at each call site means an
 * invalidation and the query it is meant to invalidate cannot drift apart -
 * the usual cause of "the list did not update after I saved".
 */
export const teamKeys = {
  all: ['teams'] as const,
  detail: (id: string) => ['teams', id] as const,
};

export function listTeams(): Promise<Team[]> {
  return api('/teams', teamsResponseSchema).then((result) => result.teams);
}

export function getTeam(id: string): Promise<Team> {
  return api(`/teams/${id}`, teamResponseSchema).then((result) => result.team);
}

export function createTeam(name: string): Promise<Team> {
  return api('/teams', teamResponseSchema, { method: 'POST', body: { name } }).then(
    (result) => result.team,
  );
}

export function createInvite(teamId: string): Promise<TeamInvite> {
  return api(`/teams/${teamId}/invites`, inviteResponseSchema, { method: 'POST' }).then(
    (result) => result.invite,
  );
}

export function joinTeam(code: string): Promise<Team> {
  return api('/teams/join', teamResponseSchema, { method: 'POST', body: { code } }).then(
    (result) => result.team,
  );
}

export function removeMember(teamId: string, userId: string): Promise<Team> {
  return api(`/teams/${teamId}/members/${userId}`, teamResponseSchema, { method: 'DELETE' }).then(
    (result) => result.team,
  );
}

export function updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<Team> {
  return api(`/teams/${teamId}/members/${userId}`, teamResponseSchema, {
    method: 'PATCH',
    body: { role },
  }).then((result) => result.team);
}
