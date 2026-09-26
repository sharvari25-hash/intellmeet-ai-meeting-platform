import { describe, expect, it } from 'vitest';
import { joinPath, parseJoinInput } from './joinCode';

describe('parseJoinInput', () => {
  it('reads a 7-character code as a room, in any case', () => {
    expect(parseJoinInput('t6g59g3')).toEqual({ kind: 'room', code: 'T6G59G3' });
    expect(parseJoinInput('  T6G59G3 ')).toEqual({ kind: 'room', code: 'T6G59G3' });
  });

  it('reads an 8-character code as a team invite, not a room', () => {
    // This used to open /app/room/ABCD2345 and report "No meeting found".
    expect(parseJoinInput('abcd2345')).toEqual({ kind: 'invite', code: 'ABCD2345' });
  });

  it('ignores the spaces and dashes a code was read out with', () => {
    expect(parseJoinInput('T6G 59G3')).toEqual({ kind: 'room', code: 'T6G59G3' });
    expect(parseJoinInput('ABCD-2345')).toEqual({ kind: 'invite', code: 'ABCD2345' });
  });

  it('takes the code out of a pasted room link', () => {
    // This used to navigate to /app/room/HTTPS:/... and show "Page not found".
    expect(parseJoinInput('https://intellmeet.example/app/room/t6g59g3?utm=whatsapp')).toEqual({
      kind: 'room',
      code: 'T6G59G3',
    });
  });

  it('takes the code out of a pasted team invite link', () => {
    expect(parseJoinInput('https://intellmeet.example/join/ABCD2345')).toEqual({
      kind: 'invite',
      code: 'ABCD2345',
    });
  });

  it('refuses anything that is neither', () => {
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('ABC')).toBeNull();
    expect(parseJoinInput('ABCDEFGHJK')).toBeNull();
    expect(parseJoinInput('T6G59G!')).toBeNull();
    expect(parseJoinInput('https://intellmeet.example/app/room/../../evil')).toBeNull();
  });
});

describe('joinPath', () => {
  it('sends a room to the room and an invite to the join page', () => {
    expect(joinPath({ kind: 'room', code: 'T6G59G3' })).toBe('/app/room/T6G59G3');
    expect(joinPath({ kind: 'invite', code: 'ABCD2345' })).toBe('/join/ABCD2345');
  });
});
