import { Types } from 'mongoose';
import {
  INVITE_CODE_LENGTH,
  teamSchema,
  type Team as TeamDto,
  type TeamInvite,
  type TeamRole,
} from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { generateCode, slugify } from '../../lib/ids.js';
import { User } from '../users/user.model.js';
import { Team, type TeamDocument } from './team.model.js';

/** How long a generated invite code stays valid. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Builds the client-facing team object.
 *
 * Members are hydrated with their user details in a single `$in` query rather
 * than one lookup per member, and the caller's own role is folded in as
 * `myRole` so the UI can hide admin-only actions without a second request.
 *
 * `inviteCodes` is never included: an ordinary member must not be able to read
 * live invite codes out of a team response.
 */
export async function toTeamDto(team: TeamDocument, viewerId: string): Promise<TeamDto> {
  const memberIds = team.members.map((member) => member.userId);
  const users = await User.find({ _id: { $in: memberIds } });
  const byId = new Map(users.map((user) => [user._id.toString(), user]));

  const members = team.members.flatMap((member) => {
    const user = byId.get(member.userId.toString());
    // A member whose account was deleted is skipped rather than rendered as a
    // half-empty row.
    if (!user) return [];

    return [
      {
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      },
    ];
  });

  return teamSchema.parse({
    id: team._id.toString(),
    name: team.name,
    slug: team.slug,
    ownerId: team.ownerId.toString(),
    members,
    myRole: findMemberRole(team, viewerId) ?? 'member',
    createdAt: team.createdAt.toISOString(),
  });
}

function findMemberRole(team: TeamDocument, userId: string): TeamRole | undefined {
  return team.members.find((member) => member.userId.toString() === userId)?.role;
}

/**
 * Loads a team the user is allowed to see, enforcing membership.
 *
 * Every team-scoped read goes through here. Centralising the check means a new
 * endpoint cannot accidentally omit it, and a non-member gets 404 rather than
 * 403 - confirming "this team exists, you just cannot see it" leaks the
 * existence of other tenants' teams.
 */
export async function getTeamForMember(
  teamId: string,
  userId: string,
): Promise<{ team: TeamDocument; role: TeamRole }> {
  const team = await Team.findById(teamId);
  if (!team) throw AppError.notFound('Team not found');

  const role = findMemberRole(team, userId);
  if (!role) throw AppError.notFound('Team not found');

  return { team, role };
}

/** Same as `getTeamForMember`, but additionally requires the team-admin role. */
export async function getTeamForAdmin(teamId: string, userId: string): Promise<TeamDocument> {
  const { team, role } = await getTeamForMember(teamId, userId);

  if (role !== 'admin') {
    // The caller is a member, so the team's existence is not a secret to them:
    // 403 is both accurate and more useful than 404 here.
    throw AppError.forbidden('Only team admins can perform this action');
  }

  return team;
}

export async function createTeam(name: string, ownerId: string): Promise<TeamDto> {
  const team = await Team.create({
    name,
    slug: slugify(name),
    ownerId: new Types.ObjectId(ownerId),
    // The creator is seeded as a team admin; otherwise nobody could ever
    // invite anyone to the team they just made.
    members: [{ userId: new Types.ObjectId(ownerId), role: 'admin', joinedAt: new Date() }],
  });

  return toTeamDto(team, ownerId);
}

export async function listMyTeams(userId: string): Promise<TeamDto[]> {
  const teams = await Team.find({ 'members.userId': userId }).sort({ createdAt: -1 });
  return Promise.all(teams.map((team) => toTeamDto(team, userId)));
}

export async function getTeam(teamId: string, userId: string): Promise<TeamDto> {
  const { team } = await getTeamForMember(teamId, userId);
  return toTeamDto(team, userId);
}

/**
 * Mints an invite code for a team.
 *
 * Codes are short and human-typeable, and collisions are only checked within
 * the set of *live* codes across all teams - a code that expired last week
 * being reissued is harmless.
 */
export async function createInvite(teamId: string, userId: string): Promise<TeamInvite> {
  const team = await getTeamForAdmin(teamId, userId);

  let code = generateCode(INVITE_CODE_LENGTH);
  // 30^8 ≈ 6.5e11 combinations, so a retry is close to impossible - but
  // "close to" is not "never", and the unique-ish lookup is cheap.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await Team.exists({
      'inviteCodes.code': code,
      'inviteCodes.expiresAt': { $gt: new Date() },
    });
    if (!clash) break;
    code = generateCode(INVITE_CODE_LENGTH);
  }

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  team.inviteCodes.push({
    code,
    expiresAt,
    createdBy: new Types.ObjectId(userId),
    createdAt: new Date(),
  });
  await team.save();

  return {
    code,
    expiresAt: expiresAt.toISOString(),
    // Returned so the client can build a shareable link without hard-coding
    // the route shape in two places.
    joinPath: `${env.CLIENT_URL}/join/${code}`,
  };
}

/**
 * Redeems an invite code.
 *
 * Idempotent: joining a team you are already in returns the team rather than
 * erroring, because a user clicking the same invite link twice has not done
 * anything wrong.
 */
export async function joinTeam(code: string, userId: string): Promise<TeamDto> {
  const now = new Date();

  const team = await Team.findOne({
    inviteCodes: {
      $elemMatch: { code, expiresAt: { $gt: now }, revokedAt: { $exists: false } },
    },
  });

  if (!team) throw AppError.notFound('That invite code is invalid or has expired');

  if (!findMemberRole(team, userId)) {
    team.members.push({ userId: new Types.ObjectId(userId), role: 'member', joinedAt: now });
    await team.save();
  }

  return toTeamDto(team, userId);
}

export async function removeMember(
  teamId: string,
  actorId: string,
  targetUserId: string,
): Promise<TeamDto> {
  const team = await getTeamForAdmin(teamId, actorId);

  if (team.ownerId.toString() === targetUserId) {
    // Removing the owner would leave the team with an ownerId pointing at a
    // non-member, and nobody with an unambiguous claim to it.
    throw AppError.conflict('The team owner cannot be removed. Transfer ownership first.');
  }

  if (!findMemberRole(team, targetUserId)) {
    throw AppError.notFound('That user is not a member of this team');
  }

  // splice, not reassignment: `members` is a Mongoose DocumentArray, and
  // replacing it with a plain array loses the change tracking that makes
  // save() emit an update.
  const index = team.members.findIndex((member) => member.userId.toString() === targetUserId);
  team.members.splice(index, 1);
  await team.save();

  return toTeamDto(team, actorId);
}

export async function updateMemberRole(
  teamId: string,
  actorId: string,
  targetUserId: string,
  role: TeamRole,
): Promise<TeamDto> {
  const team = await getTeamForAdmin(teamId, actorId);

  if (team.ownerId.toString() === targetUserId && role !== 'admin') {
    // Same reasoning as above: the owner must retain the ability to administer
    // their own team, or it becomes permanently unmanageable.
    throw AppError.conflict('The team owner must remain an admin');
  }

  const member = team.members.find((entry) => entry.userId.toString() === targetUserId);
  if (!member) throw AppError.notFound('That user is not a member of this team');

  member.role = role;
  await team.save();

  return toTeamDto(team, actorId);
}
