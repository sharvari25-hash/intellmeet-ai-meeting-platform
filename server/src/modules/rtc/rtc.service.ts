import type { IceServer, IceServersResponse } from '@intellmeet/shared';
import { env } from '../../config/env.js';

/**
 * Builds the ICE server list a browser needs to negotiate a peer connection.
 *
 * STUN alone is enough for most home and office networks: it only tells a peer
 * its own public address. Symmetric NATs and strict corporate firewalls need
 * TURN, which *relays* the media and therefore costs bandwidth - which is why
 * its credentials never ship in the client bundle. They are handed out here,
 * per call, to authenticated users only.
 */
export function getIceServers(): IceServersResponse {
  const iceServers: IceServer[] = [{ urls: env.STUN_URLS }];

  const hasTurn = Boolean(env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL);

  if (hasTurn) {
    iceServers.push({
      urls: env.TURN_URLS as string[],
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }

  // `hasTurn: false` lets the lobby warn that a restrictive network may fail,
  // instead of the call simply never connecting with no explanation.
  return { iceServers, hasTurn };
}
