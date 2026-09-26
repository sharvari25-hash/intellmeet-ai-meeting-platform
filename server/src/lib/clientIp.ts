import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

/**
 * Addresses that are never a visitor's public address: private networks,
 * loopback, link-local, carrier-grade NAT, and their IPv6 equivalents. One of
 * these just before Cloudflare's address came from a proxy on the caller's
 * side (an office or college gateway), not from Vercel, and is not an
 * identity.
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
// No `::ffff:0:0/96` (IPv4-mapped) here: a BlockList checks every IPv4
// address against that rule too, so it would mark all of IPv4 as private.
// The IPv4 ranges above already cover the mapped forms.
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

function isPublicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false;
  return !NOT_PUBLIC.check(address, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * The address a request really came from, for rate limits and the session
 * record.
 *
 * Production has two paths to the API, and Express's `trust proxy` cannot
 * serve both: behind Render, `req.ip` is one of Render's own proxy addresses
 * (measured: every visitor shared one or two rate-limit buckets).
 *
 * - **Browsers' REST calls** go through the Vercel rewrite. Vercel overwrites
 *   `X-Forwarded-For` with the visitor's address (it refuses to forward one a
 *   client sent), then Cloudflare, in front of every Render service, appends
 *   the address that connected to it - Vercel's - and sets `CF-Connecting-IP`
 *   to it. The chain reaches us as `<visitor>, <Vercel>, <Render's proxies>`.
 * - **Everything else** (Socket.io, scripts) connects to Render directly:
 *   `CF-Connecting-IP` is the caller.
 *
 * So: start from `CF-Connecting-IP`, which the caller cannot set (Cloudflare
 * refuses a request that carries one, error 1000), and if a public address
 * sits just before it in `X-Forwarded-For`, that is who it forwarded for.
 *
 * The limit of this: a caller who bypasses Vercel can put any address there
 * and pick their own rate-limit key. Per-IP limits hold for everyone who uses
 * the app; limits that must hold against a deliberate attacker are keyed on
 * something else (the per-account sign-in limit, the demo guest ceiling). See
 * docs/deployment.md, "Client IP addresses".
 *
 * With no `CF-Connecting-IP` (development, tests, Docker Compose, Kubernetes)
 * this is `req.ip`, exactly as before.
 */
export function clientIp(req: Pick<Request, 'ip' | 'get'>): string {
  const edge = req.get('cf-connecting-ip')?.trim();
  if (!edge || isIP(edge) === 0) return req.ip ?? 'unknown';

  const chain = (req.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const at = chain.lastIndexOf(edge);
  const forwardedFor = at > 0 ? chain[at - 1] : undefined;

  return forwardedFor && isPublicIp(forwardedFor) ? forwardedFor : edge;
}
