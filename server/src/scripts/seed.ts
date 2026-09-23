import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../config/db.js';
import { env } from '../config/env.js';
import { generateCode } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { hashPassword } from '../lib/password.js';
import {
  DEMO_PASSWORD,
  DEMO_TEAMMATES,
  DEMO_TEAM_NAME,
  DEMO_TEAM_SLUG,
} from '../modules/demo/demo.constants.js';
import { seedDemoMeetings } from '../modules/demo/demo.meetings.js';
import { Team } from '../modules/teams/team.model.js';
import { User } from '../modules/users/user.model.js';

/**
 * Seeds the demo workspace.
 *
 * `POST /api/auth/demo` signs in as the account created here, so reviewers can
 * use the product without registering. The script is **idempotent**: it
 * upserts by email and team slug, so it is safe to run repeatedly and safe to
 * point at the production database after a deploy.
 *
 * Phase 6 adds three past meetings with transcripts and AI insights (from
 * `server/fixtures/`). Tasks follow in Phase 8, when that model exists.
 */

async function upsertUser(name: string, email: string, passwordHash: string, isDemo: boolean) {
  const existing = await User.findOne({ email });
  if (existing) return existing;

  return User.create({
    name,
    email,
    passwordHash,
    role: 'member',
    authProvider: isDemo ? 'demo' : 'local',
  });
}

async function seed(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI });

  // Hash once and reuse: bcrypt at cost 12 is ~350ms, and every seeded account
  // shares the same demo password anyway.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const demoEmail = env.DEMO_EMAIL.toLowerCase();
  const demoUser = await upsertUser('Demo User', demoEmail, passwordHash, true);

  const teammates = await Promise.all(
    DEMO_TEAMMATES.map((mate) => upsertUser(mate.name, mate.email, passwordHash, false)),
  );

  let team = await Team.findOne({ slug: DEMO_TEAM_SLUG });

  if (!team) {
    team = await Team.create({
      name: DEMO_TEAM_NAME,
      slug: DEMO_TEAM_SLUG,
      ownerId: demoUser._id,
      members: [
        { userId: demoUser._id, role: 'admin', joinedAt: new Date() },
        ...teammates.map((mate, index) => ({
          userId: mate._id,
          role: DEMO_TEAMMATES[index]?.role ?? 'member',
          joinedAt: new Date(),
        })),
      ],
      inviteCodes: [
        {
          code: generateCode(8),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdBy: demoUser._id,
          createdAt: new Date(),
        },
      ],
    });
  } else {
    // Re-running after adding a teammate should pick them up without
    // duplicating anyone already in the team.
    const existingIds = new Set(team.members.map((member) => member.userId.toString()));
    for (const [index, mate] of teammates.entries()) {
      if (existingIds.has(mate._id.toString())) continue;
      team.members.push({
        userId: new Types.ObjectId(mate._id),
        role: DEMO_TEAMMATES[index]?.role ?? 'member',
        joinedAt: new Date(),
      });
    }
    await team.save();
  }

  // Past meetings with transcripts, summaries and action items, so the demo
  // opens onto a workspace that already has history in it.
  const everyone = [demoUser, ...teammates].map((user) => ({
    id: user._id.toString(),
    name: user.name,
  }));
  const meetings = await seedDemoMeetings({ teamId: team._id.toString(), people: everyone });

  logger.info(
    {
      demoEmail,
      seededMeetings: meetings,
      demoPassword: DEMO_PASSWORD,
      team: team.name,
      slug: team.slug,
      members: team.members.length,
    },
    '[seed] demo workspace ready',
  );

  // Printed rather than logged so it is readable even with LOG_LEVEL=silent.
  console.log(`\nDemo login:  ${demoEmail} / ${DEMO_PASSWORD}`);
  console.log(`Or call:     POST /api/auth/demo  (no credentials needed)`);
  console.log(`Team:        ${team.name} (${team.slug}), ${team.members.length} members`);
  console.log(
    `Meetings:    ${meetings.created} created, ${meetings.updated} refreshed (sample history with AI summaries)\n`,
  );
}

seed()
  .then(() => disconnectMongo())
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, '[seed] failed');
    void disconnectMongo().finally(() => process.exit(1));
  });
