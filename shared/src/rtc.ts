import { z } from 'zod';

/**
 * One ICE server, in exactly the shape `RTCPeerConnection` expects, so the
 * client can pass the array straight through without mapping it.
 */
export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

/**
 * Response of `GET /api/rtc/ice-servers`.
 *
 * TURN credentials are fetched at call time rather than embedded in the
 * client bundle: the bundle is public, and a leaked TURN credential is a
 * relay that somebody else pays for. `hasTurn` lets the UI warn that
 * restrictive networks may fail when only STUN is configured.
 */
export const iceServersResponseSchema = z.object({
  iceServers: z.array(iceServerSchema),
  hasTurn: z.boolean(),
});
export type IceServersResponse = z.infer<typeof iceServersResponseSchema>;
