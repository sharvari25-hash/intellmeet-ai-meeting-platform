import { Types } from 'mongoose';
import {
  meetingInsightSchema,
  meetingIntelligenceSchema,
  transcriptSchema,
  type ActionItemInput,
  type FieldIssue,
  type MeetingIntelligence,
  type UpdateInsightInput,
} from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { getMeetingForHost, getMeetingForMember } from '../meetings/meeting.service.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { MeetingInsight } from './insight.model.js';
import { Transcript, type TranscriptDocument } from './transcript.model.js';

/** Pipeline steps during which the insight is about to be replaced. */
const IN_PROGRESS = ['queued', 'transcribing', 'summarizing'];

/**
 * The insight exactly as stored.
 *
 * Read `lean` on purpose: action items written before they had ids (Phase 6)
 * have none in the database, and a hydrated Mongoose document invents a fresh
 * random `_id` for each of them on *every* read. Ids that change between two
 * requests would make an edit unable to say which item it is changing.
 */
function loadInsight(meetingId: Types.ObjectId) {
  return MeetingInsight.findOne({ meetingId }).lean();
}
type StoredInsight = NonNullable<Awaited<ReturnType<typeof loadInsight>>>;

function toTranscriptDto(doc: TranscriptDocument) {
  return transcriptSchema.parse({
    meetingId: doc.meetingId.toString(),
    text: doc.text,
    segments: doc.segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speaker: segment.speaker ?? null,
    })),
    language: doc.language ?? null,
    provider: doc.provider,
    createdAt: doc.createdAt.toISOString(),
  });
}

function toInsightDto(doc: StoredInsight) {
  return meetingInsightSchema.parse({
    meetingId: doc.meetingId.toString(),
    summary: doc.summary,
    keyDecisions: doc.keyDecisions,
    actionItems: doc.actionItems.map((item, index) => ({
      // A legacy item has no stored id. Its position is stable until the
      // first edit, which gives every item a real one.
      id: item._id ? item._id.toString() : `legacy-${index}`,
      text: item.text,
      assigneeName: item.assigneeName ?? null,
      assigneeId: item.assigneeId ? item.assigneeId.toString() : null,
      dueDate: item.dueDate ?? null,
      status: item.status ?? 'open',
      taskId: item.taskId ? item.taskId.toString() : null,
    })),
    provider: doc.provider,
    createdAt: doc.createdAt.toISOString(),
    editedAt: doc.editedAt ? doc.editedAt.toISOString() : null,
    editedByName: doc.editedByName ?? null,
  });
}

/**
 * The AI side of a meeting: status, transcript and insight together.
 *
 * One request rather than three, because the meeting page always wants all of
 * them at once, and re-fetches the lot whenever an `ai:status` event arrives.
 */
export async function getMeetingIntelligence(
  meetingId: string,
  userId: string,
): Promise<MeetingIntelligence> {
  const meeting = await getMeetingForMember(meetingId, userId);

  const [transcript, insight] = await Promise.all([
    Transcript.findOne({ meetingId: meeting._id }),
    loadInsight(meeting._id),
  ]);

  return meetingIntelligenceSchema.parse({
    meetingId: meeting._id.toString(),
    aiStatus: meeting.aiStatus,
    aiError: meeting.aiError ?? null,
    transcript: transcript ? toTranscriptDto(transcript) : null,
    insight: insight ? toInsightDto(insight) : null,
  });
}

/**
 * The host's corrections to the AI output.
 *
 * Host only, like every other change to a meeting: the host is accountable
 * for the minutes. Refused while the pipeline is running, because it is about
 * to overwrite the insight and the edit would silently vanish. Records who
 * edited and when, so the page stops presenting the text as purely
 * machine-written.
 */
export async function updateInsight(
  meetingId: string,
  userId: string,
  input: UpdateInsightInput,
): Promise<MeetingIntelligence> {
  const meeting = await getMeetingForHost(meetingId, userId);

  if (IN_PROGRESS.includes(meeting.aiStatus)) {
    throw AppError.conflict('The summary is still being generated. Edit it once it is ready.');
  }

  const stored = await loadInsight(meeting._id);
  if (!stored) throw AppError.notFound('This meeting has no summary to edit yet');

  const editor = await User.findById(userId).select('name');

  const changes: Record<string, unknown> = {
    editedAt: new Date(),
    editedBy: new Types.ObjectId(userId),
    editedByName: editor?.name ?? null,
  };
  if (input.summary !== undefined) changes.summary = input.summary;
  if (input.keyDecisions !== undefined) changes.keyDecisions = input.keyDecisions;
  if (input.actionItems !== undefined) {
    changes.actionItems = await resolveActionItems(input.actionItems, stored, meeting.teamId);
  }

  await MeetingInsight.updateOne({ _id: stored._id }, { $set: changes });

  return getMeetingIntelligence(meetingId, userId);
}

/**
 * Turns submitted items into stored ones.
 *
 * - An item keeps its id (and so its Kanban task link) when it is one that
 *   already existed; anything else is a new item with a new id. An id the
 *   client made up can therefore never adopt somebody else's task.
 * - An owner must be a member of the meeting's team: they have to be able to
 *   see the meeting their task came from. An owner the item already had is
 *   let through even if they have since left, so an unrelated edit does not
 *   fail on them.
 * - The owner's name always comes from their account, never from the
 *   request. A free-text name is kept only for an owner with no account.
 */
async function resolveActionItems(
  items: ActionItemInput[],
  stored: StoredInsight,
  teamId: Types.ObjectId,
) {
  const existing = new Map(
    stored.actionItems.flatMap((item) => (item._id ? [[item._id.toString(), item] as const] : [])),
  );
  const previousOwners = new Set(
    stored.actionItems.flatMap((item) => (item.assigneeId ? [item.assigneeId.toString()] : [])),
  );

  const ownerIds = [
    ...new Set(items.flatMap((item) => (item.assigneeId ? [item.assigneeId] : []))),
  ];

  const team = await Team.findById(teamId).select('members.userId');
  const members = new Set(team?.members.map((member) => member.userId.toString()) ?? []);

  const issues: FieldIssue[] = items.flatMap((item, index) =>
    item.assigneeId && !members.has(item.assigneeId) && !previousOwners.has(item.assigneeId)
      ? [
          {
            path: `body.actionItems.${index}.assigneeId`,
            message: 'The owner must be a member of this meeting’s team',
          },
        ]
      : [],
  );
  if (issues.length > 0) throw AppError.validation(issues);

  const owners = await User.find({ _id: { $in: ownerIds } }).select('name');
  const names = new Map(owners.map((owner) => [owner._id.toString(), owner.name]));

  return items.map((item) => {
    const previous = item.id ? existing.get(item.id) : undefined;
    // An owner whose account has since been deleted falls back to the name.
    const ownerId = item.assigneeId && names.has(item.assigneeId) ? item.assigneeId : null;

    return {
      ...(previous ? { _id: previous._id } : {}),
      text: item.text,
      assigneeId: ownerId ? new Types.ObjectId(ownerId) : null,
      assigneeName: ownerId ? (names.get(ownerId) ?? null) : item.assigneeName || null,
      dueDate: item.dueDate,
      status: item.status,
      taskId: previous?.taskId ?? null,
    };
  });
}
