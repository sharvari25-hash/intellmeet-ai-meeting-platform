import { describe, expect, it } from 'vitest';
import { clientIp } from './clientIp.js';

/** A request as Express presents it: `req.ip` plus case-insensitive headers. */
function request(headers: Record<string, string>, ip = '10.0.0.7') {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { ip, get: (name: string) => lower[name.toLowerCase()] } as Parameters<typeof clientIp>[0];
}

const VISITOR = '203.0.113.7';
const VERCEL = '198.51.100.20';
const RENDER_PROXY = '10.214.3.9';

describe('clientIp', () => {
  it('is req.ip when nothing sits in front of the API (development, tests, Kubernetes)', () => {
    expect(clientIp(request({}, '192.168.1.5'))).toBe('192.168.1.5');
    // Without Cloudflare, X-Forwarded-For is whatever the caller wrote.
    expect(clientIp(request({ 'X-Forwarded-For': VISITOR }, '192.168.1.5'))).toBe('192.168.1.5');
  });

  it('is the caller for a direct request to Render (Socket.io, scripts)', () => {
    expect(
      clientIp(
        request({
          'CF-Connecting-IP': VISITOR,
          'X-Forwarded-For': `${VISITOR}, ${RENDER_PROXY}`,
        }),
      ),
    ).toBe(VISITOR);
  });

  it('is the visitor Vercel forwarded for, not Vercel, on a rewritten REST call', () => {
    expect(
      clientIp(
        request({
          'CF-Connecting-IP': VERCEL,
          'X-Forwarded-For': `${VISITOR}, ${VERCEL}, ${RENDER_PROXY}`,
        }),
      ),
    ).toBe(VISITOR);
  });

  it('gives one visitor the same address on both paths', () => {
    const direct = request({ 'CF-Connecting-IP': VISITOR, 'X-Forwarded-For': VISITOR });
    const viaVercel = request({
      'CF-Connecting-IP': VERCEL,
      'X-Forwarded-For': `${VISITOR}, ${VERCEL}`,
    });
    expect(clientIp(direct)).toBe(clientIp(viaVercel));
  });

  it('reads IPv6 visitors the same way', () => {
    const visitor = '2001:db8:85a3::8a2e:370:7334';
    expect(
      clientIp(request({ 'CF-Connecting-IP': VERCEL, 'X-Forwarded-For': `${visitor}, ${VERCEL}` })),
    ).toBe(visitor);
  });

  it('ignores a private address before the caller: an office or college gateway, not Vercel', () => {
    for (const gateway of ['10.1.2.3', '192.168.0.4', '172.20.1.1', '100.64.0.9', '127.0.0.1']) {
      expect(
        clientIp(
          request({ 'CF-Connecting-IP': VISITOR, 'X-Forwarded-For': `${gateway}, ${VISITOR}` }),
        ),
      ).toBe(VISITOR);
    }
  });

  it('ignores anything before the caller that is not an address', () => {
    for (const junk of ['unknown', '<script>', '999.1.1.1', '']) {
      expect(
        clientIp(
          request({ 'CF-Connecting-IP': VISITOR, 'X-Forwarded-For': `${junk}, ${VISITOR}` }),
        ),
      ).toBe(VISITOR);
    }
  });

  it('is the Cloudflare address when it is missing from the chain', () => {
    expect(
      clientIp(request({ 'CF-Connecting-IP': VISITOR, 'X-Forwarded-For': RENDER_PROXY })),
    ).toBe(VISITOR);
    expect(clientIp(request({ 'CF-Connecting-IP': VISITOR }))).toBe(VISITOR);
  });

  it('falls back to req.ip when CF-Connecting-IP is not an address', () => {
    expect(clientIp(request({ 'CF-Connecting-IP': 'not-an-ip' }, '192.168.1.5'))).toBe(
      '192.168.1.5',
    );
  });

  it('documents its limit: a caller who bypasses Vercel can name the address before its own', () => {
    // Direct to Render with a forged header: Cloudflare appends the real
    // caller, and the public address just before it is taken. The limits
    // that must hold against this are not keyed on the address.
    expect(
      clientIp(
        request({
          'CF-Connecting-IP': VISITOR,
          'X-Forwarded-For': `198.51.100.99, ${VISITOR}`,
        }),
      ),
    ).toBe('198.51.100.99');
  });
});
