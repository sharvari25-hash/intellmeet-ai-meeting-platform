import { z } from 'zod';
import { objectIdSchema } from './common.js';

/**
 * Role *within a team*, independent of the platform-wide `userRoleSchema`.
 *
 * A team admin can invite, remove members and change roles inside that team
 * only. This is what almost every authorisation check in the product uses;
 * the platform role is reserved for cross-tenant operations.
 */
export const TEAM_ROLES = ['admin', 'member'] as const;
export const teamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(60),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

/** The length of every team invite code; see `ROOM_CODE_LENGTH`. */
export const INVITE_CODE_LENGTH = 8;

/**
 * The seeded demo team's slug. Every "Try Live Demo" guest is put in this
 * team, which is how the client knows who can join a meeting held in it.
 */
export const DEMO_TEAM_SLUG = 'intellmeet-demo';

export const joinTeamSchema = z.object({
  code: z.string().trim().toUpperCase().pipe(z.string().min(6, 'Invite code is too short').max(16)),
});
export type JoinTeamInput = z.infer<typeof joinTeamSchema>;

export const updateMemberRoleSchema = z.object({ role: teamRoleSchema });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/** A member as returned to the client: the user's public fields plus their team role. */
export const teamMemberSchema = z.object({
  userId: objectIdSchema,
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: teamRoleSchema,
  joinedAt: z.string(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  slug: z.string(),
  ownerId: objectIdSchema,
  members: z.array(teamMemberSchema),
  /** The requesting user's role in this team, so the UI can hide admin actions. */
  myRole: teamRoleSchema,
  createdAt: z.string(),
});
export type Team = z.infer<typeof teamSchema>;

/**
 * A freshly minted invite. The server returns the bare `code` as well as a
 * ready-made `joinPath` so the client can build a shareable link without
 * duplicating the route shape.
 */
export const teamInviteSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
  joinPath: z.string(),
});
export type TeamInvite = z.infer<typeof teamInviteSchema>;

/** Route params for the member sub-resource: `/api/teams/:id/members/:userId`. */
export const teamMemberParamsSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
});
