import { INVITE_CODE_LENGTH, ROOM_CODE_LENGTH } from '@intellmeet/shared';

/** Where something typed into "Join with a code" should go. */
export type JoinTarget = { kind: 'room'; code: string } | { kind: 'invite'; code: string };

/** The code alphabet, as loosely as the server's own schemas accept it. */
const CODE = /^[A-Z2-9]+$/;

/**
 * Works out what somebody put into "Join with a code".
 *
 * Room codes and team invite codes share an alphabet and differ only in
 * length, and people mix them up: an 8-character invite typed here used to
 * open the room page and report that no such meeting existed. Length decides
 * which one it is.
 *
 * A whole link is accepted too, because long-pressing a link in a chat app
 * copies the link, not the code - and that used to open a "Page not found".
 * Returns null for anything that is neither.
 */
export function parseJoinInput(input: string): JoinTarget | null {
  const trimmed = input.trim();

  const link = /\/(room|join)\/([^/?#\s]+)/i.exec(trimmed);
  if (link) {
    const code = (link[2] ?? '').toUpperCase();
    if (!CODE.test(code)) return null;
    return { kind: link[1]?.toLowerCase() === 'room' ? 'room' : 'invite', code };
  }

  // People copy codes with the spaces or dashes they were read out with.
  const code = trimmed.replace(/[\s-]/g, '').toUpperCase();
  if (!CODE.test(code)) return null;
  if (code.length === ROOM_CODE_LENGTH) return { kind: 'room', code };
  if (code.length === INVITE_CODE_LENGTH) return { kind: 'invite', code };
  return null;
}

/** The app path for a parsed code. */
export function joinPath(target: JoinTarget): string {
  return target.kind === 'room' ? `/app/room/${target.code}` : `/join/${target.code}`;
}
