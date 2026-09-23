import { z } from 'zod';
import { publicUserSchema, type PublicUser, type UpdateMeInput } from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const userResponseSchema = z.object({ user: publicUserSchema });

export const userKeys = {
  me: ['users', 'me'] as const,
};

export function getMe(): Promise<PublicUser> {
  return api('/users/me', userResponseSchema).then((result) => result.user);
}

export function updateMe(input: UpdateMeInput): Promise<PublicUser> {
  return api('/users/me', userResponseSchema, { method: 'PATCH', body: input }).then(
    (result) => result.user,
  );
}
