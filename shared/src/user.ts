import { z } from 'zod';
import { httpsUrlSchema, objectIdSchema } from './common.js';

/**
 * Platform-wide role, distinct from a user's role *within a team*
 * (see `teamRoleSchema`). This one gates cross-tenant operations such as the
 * future admin console; team membership gates everything tenant-scoped.
 */
export const USER_ROLES = ['admin', 'member'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * How the account authenticates. `demo` marks the shared read-only-ish demo
 * account so destructive operations can refuse to run against it.
 * A `google` value is added if OAuth2 is implemented later.
 */
export const AUTH_PROVIDERS = ['local', 'demo'] as const;
export const authProviderSchema = z.enum(AUTH_PROVIDERS);
export type AuthProvider = z.infer<typeof authProviderSchema>;

/**
 * The only user shape that ever leaves the server.
 *
 * Defining it as a schema rather than a TypeScript type means the serialiser
 * is *checked*: if someone adds `passwordHash` to the object being returned,
 * zod strips it rather than leaking it.
 */
export const publicUserSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: userRoleSchema,
  authProvider: authProviderSchema,
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** Body of `PATCH /api/users/me`. */
export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    // `null` clears the avatar; a string sets it. https only - see
    // httpsUrlSchema for why a plain URL check is not sufficient here.
    avatarUrl: httpsUrlSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
