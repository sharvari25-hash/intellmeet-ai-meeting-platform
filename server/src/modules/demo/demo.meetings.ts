import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { z } from 'zod';
import { transcriptSegmentSchema } from '@intellmeet/shared';
import { matchAssignee } from '../../lib/ai/assignee.js';
import { generateCode } from '../../lib/ids.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { Meeting } from '../meetings/meeting.model.js';

/**
 * Sample meetings: the demo's history, and the AI evaluation set.
 *
 * Each fixture is a realistic transcript plus a hand-written reference answer
 * (summary, decisions, owners, deadlines). The same files serve two purposes,
 * which keeps them honest:
 *
 * - the seed stores the reference as the meeting's insight, so a reviewer who
 *   signs into the demo finds past meetings that already have summaries;
 * - the evaluation script (`npm run eval:ai`) runs the configured model over
 *   the transcript and scores it against the reference.
 *
 * They live in `server/fixtures/` rather than under `src/`, so they are data,
 * not code, and ship with the image unchanged.
 */

/** `server/fixtures`, from both src/modules/demo and dist/modules/demo. */
export const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../fixtures');

const referenceActionItemSchema = z.object({
  text: z.string(),
  assigneeName: z.string().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export const meetingFixtureSchema = z.object({
  /** Stable identity; becomes the meeting's `seedKey`. */
  key: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string(),
  /** When the meeting took place. Reference due dates are relative to this. */
  meetingDate: z.iso.datetime(),
  durationSec: z.number().int().positive(),
  host: z.string(),
  participants: z.array(z.string()).min(1),
  segments: z.array(transcriptSegmentSchema).min(1),
  reference: z.object({
    summary: z.string(),
    keyDecisions: z.array(z.string()),
    actionItems: z.array(referenceActionItemSchema),
  }),
});
export type MeetingFixture = z.infer<typeof meetingFixtureSchema>;

export async function loadMeetingFixtures(dir = FIXTURES_DIR): Promise<MeetingFixture[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();

  return Promise.all(
    files.map(async (name) => {
      const raw: unknown = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      const parsed = meetingFixtureSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Fixture ${name} is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      return parsed.data;
    }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far to move a fixture's dates so the meeting looks recent.
 *
 * Always a whole number of weeks: the transcripts say things like "by Friday",
 * and the reference deadlines only stay correct if Friday is still a Friday.
 * The result is the most recent same-weekday date at least `minDaysAgo` ago.
 */
export function weeksToShift(meetingDate: Date, now: Date, minDaysAgo: number): number {
  const target = now.getTime() - minDaysAgo * DAY_MS;
  return Math.floor((target - meetingDate.getTime()) / (7 * DAY_MS));
}

function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface SeedPerson {
  id: string;
  name: string;
}

export interface SeedMeetingsResult {
  created: number;
  updated: number;
}

/**
 * Creates (or refreshes) the seeded past meetings in the demo team.
 *
 * Idempotent: each fixture is upserted by `seedKey`, so running the seed twice
 * updates the same three meetings instead of adding three more. Dates are
 * recomputed on every run, keeping the history "recent" whenever it is seeded.
 * Every seeded meeting is marked `seeded: true`, which the demo cleanup never
 * deletes.
 */
export async function seedDemoMeetings(options: {
  teamId: string;
  people: SeedPerson[];
  fixtures?: MeetingFixture[];
  now?: Date;
}): Promise<SeedMeetingsResult> {
  const fixtures = options.fixtures ?? (await loadMeetingFixtures());
  const now = options.now ?? new Date();
  const result: SeedMeetingsResult = { created: 0, updated: 0 };

  // Spread across the last couple of weeks, newest first, so the dashboard's
  // "recent meetings" looks like a real team's history.
  const ordered = [...fixtures].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));

  for (const [index, fixture] of ordered.entries()) {
    const original = new Date(fixture.meetingDate);
    const weeks = weeksToShift(original, now, 1 + index * 2);
    const shiftDays = weeks * 7;

    const startedAt = new Date(original.getTime() + shiftDays * DAY_MS);
    const endedAt = new Date(startedAt.getTime() + fixture.durationSec * 1000);

    const byName = (name: string) => options.people.find((person) => person.name === name);
    const host = byName(fixture.host) ?? options.people[0];
    if (!host) throw new Error('seedDemoMeetings needs at least one person');

    const attendees = fixture.participants.flatMap((name) => {
      const person = byName(name);
      return person ? [person] : [];
    });

    const existing = await Meeting.findOne({ seedKey: fixture.key }).select('_id');

    const meeting = await Meeting.findOneAndUpdate(
      { seedKey: fixture.key },
      {
        $set: {
          teamId: new Types.ObjectId(options.teamId),
          title: fixture.title,
          description: fixture.description,
          hostId: new Types.ObjectId(host.id),
          status: 'ended',
          scheduledAt: null,
          startedAt,
          endedAt,
          participants: attendees.map((person) => ({
            userId: new Types.ObjectId(person.id),
            joinedAt: startedAt,
            leftAt: endedAt,
          })),
          // No audio exists for a seeded meeting; the transcript is the source.
          recording: { status: 'none' },
          aiStatus: 'done',
          aiError: null,
          seeded: true,
          // Backdated, so it sorts as history rather than as brand new.
          createdAt: startedAt,
        },
        $setOnInsert: { roomCode: generateCode(7), seedKey: fixture.key },
      },
      { upsert: true, new: true, timestamps: false },
    );

    await Transcript.findOneAndUpdate(
      { meetingId: meeting._id },
      {
        $set: {
          text: fixture.segments.map((segment) => segment.text).join(' '),
          segments: fixture.segments,
          language: 'en',
          provider: 'seed',
        },
      },
      { upsert: true },
    );

    await MeetingInsight.findOneAndUpdate(
      { meetingId: meeting._id },
      {
        $set: {
          summary: fixture.reference.summary,
          keyDecisions: fixture.reference.keyDecisions,
          actionItems: fixture.reference.actionItems.map((item) => {
            const match = matchAssignee(item.assigneeName, attendees);
            return {
              text: item.text,
              assigneeName: match?.name ?? item.assigneeName,
              assigneeId: match ? new Types.ObjectId(match.id) : null,
              dueDate: item.dueDate ? shiftIsoDate(item.dueDate, shiftDays) : null,
              status: 'open',
              taskId: null,
            };
          }),
          provider: 'seed',
        },
      },
      { upsert: true },
    );

    if (existing) result.updated += 1;
    else result.created += 1;
  }

  return result;
}
