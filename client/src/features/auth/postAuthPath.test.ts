import { describe, expect, it } from 'vitest';
import { postAuthPath } from './postAuthPath';

describe('postAuthPath', () => {
  it('defaults to the dashboard', () => {
    expect(postAuthPath(null, null)).toBe('/app');
    expect(postAuthPath({}, null)).toBe('/app');
  });

  it('returns the page the user was aiming for', () => {
    expect(postAuthPath({ from: { pathname: '/app/settings' } }, null)).toBe('/app/settings');
  });

  it('puts a pending invite ahead of the remembered page', () => {
    // Someone who followed an invite link came here to join a team; the
    // dashboard can wait the one redirect it takes to get there.
    expect(postAuthPath({ from: { pathname: '/app/settings' } }, 'ABC234')).toBe('/join/ABC234');
  });

  it('encodes the code so a hostile one cannot break out of the path', () => {
    expect(postAuthPath(null, 'A/../../evil')).toBe('/join/A%2F..%2F..%2Fevil');
  });

  it('refuses a protocol-relative path, which is an open redirect', () => {
    // `//evil.example` passes a naive startsWith('/') check and sends the
    // browser to another origin entirely.
    expect(postAuthPath({ from: { pathname: '//evil.example/phish' } }, null)).toBe('/app');
  });

  it('refuses anything that is not a same-origin path', () => {
    expect(postAuthPath({ from: { pathname: 'https://evil.example' } }, null)).toBe('/app');
    expect(postAuthPath({ from: { pathname: '' } }, null)).toBe('/app');
  });
});
