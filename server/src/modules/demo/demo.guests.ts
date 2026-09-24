import { randomBytes, randomInt } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { Team } from '../teams/team.model.js';
import { User, type UserDocument } from '../users/user.model.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';

/**
 * Temporary guest accounts for "Try Live Demo".
 *
 * Every demo sign-in used to be the same seeded user, so two reviewers were
 * one person: both were host of each other's meetings (either could "End for
 * all" on the other), and the AI assigned every action item to "Demo User".
 * Each sign-in now creates a guest of its own, added to the seeded demo team,
 * which is what makes the sample meetings visible to it.
 */

/**
 * Colours double as plausible first names ("Amber, can you take that?"),
 * which matters more than it looks: the AI addresses people by first name,
 * and owners are matched back to accounts by those names.
 */
export const GUEST_COLOURS = [
  'Amber',
  'Azure',
  'Cobalt',
  'Coral',
  'Crimson',
  'Ember',
  'Indigo',
  'Ivory',
  'Jade',
  'Juniper',
  'Lilac',
  'Maple',
  'Olive',
  'Onyx',
  'Pearl',
  'Ruby',
  'Saffron',
  'Scarlet',
  'Sienna',
  'Silver',
  'Slate',
  'Teal',
  'Topaz',
  'Violet',
] as const;

export const GUEST_ANIMALS = [
  'Badger',
  'Beaver',
  'Bison',
  'Crane',
  'Dolphin',
  'Falcon',
  'Ferret',
  'Gecko',
  'Heron',
  'Ibis',
  'Koala',
  'Lemur',
  'Lynx',
  'Marten',
  'Narwhal',
  'Ocelot',
  'Otter',
  'Panda',
  'Puffin',
  'Quokka',
  'Raven',
  'Tapir',
  'Walrus',
  'Wombat',
] as const;

/**
 * A friendly two-word name that shares no word with anyone already in the
 * team.
 *
 * Not merely "different": assignee matching accepts a spoken first name, and
 * a tie between two candidates resolves to *nobody*. "Amber Otter" and "Amber
 * Heron" in one meeting would make "Amber will do it" unassignable, so a word
 * already in use is avoided while there is any alternative. Only once every
 * colour or animal is taken does a name repeat, and then it gets a number.
 */
export function pickGuestName(
  takenNames: readonly string[],
  random: (max: number) => number = randomInt,
): string {
  const usedWords = new Set(takenNames.flatMap((name) => name.toLowerCase().split(/\s+/)));
  const unused = <T extends string>(words: readonly T[]) => {
    const free = words.filter((word) => !usedWords.has(word.toLowerCase()));
    return free.length > 0 ? free : words;
  };
  const pick = <T>(words: readonly T[]) => words[random(words.length)] as T;

  const base = `${pick(unused(GUEST_COLOURS))} ${pick(unused(GUEST_ANIMALS))}`;

  const taken = new Set(takenNames.map((name) => name.toLowerCase()));
  let name = base;
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `${base} ${suffix}`;
  return name;
}

/**
 * A unique address nobody can receive mail at.
 *
 * `.invalid` is reserved for exactly this (RFC 2606), so a guest's address can
 * never collide with, or send anything to, a real mailbox.
 */
function guestEmail(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${slug}-${randomBytes(4).toString('hex')}@guest.intellmeet.invalid`;
}

/**
 * Creates a guest and adds it to the seeded demo team.
 *
 * The guest has no password, so the only way in is the session this sign-in
 * starts. It joins as a plain **member**: it can hold, record and end its own
 * meetings, but cannot remove the seeded team-mates, hand out admin, or edit
 * the sample meetings, which are hosted by the seeded Demo User.
 */
export async function createDemoGuest(): Promise<UserDocument> {
  const team = await Team.findOne({ slug: DEMO_TEAM_SLUG }).select('_id members.userId');
  if (!team) {
    throw AppError.unavailable(
      'Demo mode is not available: the demo workspace has not been seeded. Run `npm run seed -w @intellmeet/server`.',
    );
  }

  const guests = await User.countDocuments({ authProvider: 'guest' });
  if (guests >= env.DEMO_MAX_GUESTS) {
    logger.warn(
      { guests, ceiling: env.DEMO_MAX_GUESTS },
      '[demo] guest ceiling reached; refusing a demo sign-in',
    );
    throw AppError.unavailable(
      'The demo is busy right now. Please try again in a few minutes, or create a free account.',
    );
  }

  const members = await User.find({ _id: { $in: team.members.map((m) => m.userId) } }).select(
    'name',
  );
  const name = pickGuestName(members.map((member) => member.name));

  const guest = await User.create({
    name,
    email: guestEmail(name),
    role: 'member',
    authProvider: 'guest',
  });

  // A push rather than load-and-save: two guests arriving at once must not
  // overwrite each other's membership. If this fails the guest belongs to no
  // team, sees an empty workspace, and is swept like any other stale guest.
  await Team.updateOne(
    { _id: team._id },
    { $push: { members: { userId: guest._id, role: 'member', joinedAt: new Date() } } },
  );

  logger.info({ userId: guest._id.toString(), name }, '[demo] guest created');
  return guest;
}
