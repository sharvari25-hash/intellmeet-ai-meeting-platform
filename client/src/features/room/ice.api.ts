import { iceServersResponseSchema, type IceServersResponse } from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

export const iceKeys = {
  servers: ['rtc', 'ice-servers'] as const,
};

/**
 * STUN and TURN configuration, fetched at call time.
 *
 * Never baked into the bundle: the bundle is public, and a leaked TURN
 * credential is a media relay somebody else pays for. The response also says
 * whether TURN is configured at all, which the room uses to warn that a
 * restrictive network may not connect.
 */
export function fetchIceServers(): Promise<IceServersResponse> {
  return api('/rtc/ice-servers', iceServersResponseSchema);
}
