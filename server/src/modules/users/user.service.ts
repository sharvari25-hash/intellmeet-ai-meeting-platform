import { publicUserSchema, type PublicUser, type UpdateMeInput } from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { User, type UserDocument } from './user.model.js';

/**
 * Converts a user document into the only shape allowed to leave the server.
 *
 * The result is run through `publicUserSchema.parse`, which strips anything
 * not declared in the contract. That makes leaking `passwordHash` or
 * `refreshTokens` a *parse-time* impossibility rather than something a future
 * code review has to catch.
 */
export function toPublicUser(user: UserDocument): PublicUser {
  return publicUserSchema.parse({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    authProvider: user.authProvider,
    createdAt: user.createdAt.toISOString(),
  });
}

export async function getUserById(id: string): Promise<UserDocument> {
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('User not found');
  return user;
}

export async function updateMe(id: string, input: UpdateMeInput): Promise<PublicUser> {
  const user = await getUserById(id);

  if (input.name !== undefined) user.name = input.name;
  // `null` is a meaningful value here - it clears the avatar - so the check is
  // against `undefined` (field absent) rather than falsiness.
  if (input.avatarUrl !== undefined) user.avatarUrl = input.avatarUrl;

  await user.save();
  return toPublicUser(user);
}
