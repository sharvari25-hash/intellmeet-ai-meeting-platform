import { Types } from 'mongoose';
import {
  meetingSchema,
  type CreateMeetingInput,
  type ListMeetingsQuery,
  type Meeting as MeetingDto,
  type MeetingList,
  type MeetingListItem,
  type MeetingSearchMatch,
  type UpdateMeetingInput,
} from '@intellmeet/shared';
import { DEFAULT_TTL_SEC, cacheDel, cacheKeys, cached } from '../../lib/cache.js';
import { AppError } from '../../lib/errors.js';
import { generateCode } from '../../lib/ids.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { invalidateTeamAnalytics } from '../analytics/analytics.cache.js';
import { Message } from '../chat/message.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { destroyCloudinaryRecordings } from '../recordings/recording.cloudinary.js';
import { deleteLocalRecording } from '../recordings/recording.storage.js';
import { Task } from '../tasks/task.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { describeMatches, loadPreviews, rankMeetings } from './meeting.history.js';
import { Meeting, type MeetingDocument } from './meeting.model.js';

/** Room codes are 7 characters from a 30-letter unambiguous alphabet. */
const ROOM_CODE_LENGTH = 7;

/**
 * Mints a room code that is not already taken.
 *
 * Uniqueness is enforced by the index; this loop only avoids the user-visible
 * error. 30^7 is about 22 billion, so a collision is vanishingly unlikely -
 * but codes are never recycled (an ended meeting keeps its code so old links
 * cannot resolve to a new meeting), and the check is one indexed lookup.
 */
async function generateRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(ROOM_CODE_LENGTH);
    if (!(await Meeting.exists({ roomCode: code }))) return code;
  }

  throw AppError.internal('Could not allocate a unique room code');
}

/**
 * Confirms the user is a member of the team, which is the authorisation
 * boundary for everything meeting-related.
 */
async function assertTeamMember(teamId: string, userId: string): Promise<void> {
  const isMember = await Team.exists({ _id: teamId, 'members.userId': userId });
  // 404 rather than 403: confirming the team exists would leak the existence
  // of other tenants' teams, exactly as in the teams module.
  if (!isMember) throw AppError.notFound('Team not found');
}

/** All team ids the user belongs to, used to scope list queries. */
async function myTeamIds(userId: string): Promise<Types.ObjectId[]> {
  const teams = await Team.find({ 'members.userId': userId }).select('_id');
  return teams.map((team) => team._id);
}

/**
 * The part of a meeting DTO that does not depend on who is asking.
 *
 * Splitting `isHost` out is what makes the view cacheable: everything else is
 * identical for every member of the team, and it is all plain strings, so it
 * survives a JSON round trip through Redis without the Date fields degrading
 * into strings the way a cached Mongoose document would.
 */
type MeetingView = Omit<MeetingDto, 'isHost'>;

function withViewer(view: MeetingView, viewerId: string): MeetingDto {
  return { ...view, isHost: view.hostId === viewerId };
}

export async function toMeetingDto(
  meeting: MeetingDocument,
  viewerId: string,
): Promise<MeetingDto> {
  return withViewer(await buildMeetingView(meeting), viewerId);
}

type UserLookup = Map<string, { _id: Types.ObjectId; name: string; avatarUrl?: string | null }>;

/**
 * Everyone a set of meetings mentions - hosts and participants - in one
 * `$in`, rather than a lookup per person per meeting. A history page of
 * twenty meetings is one query, not twenty.
 */
async function loadPeople(meetings: MeetingDocument[]): Promise<UserLookup> {
  const ids = new Set<string>();
  for (const meeting of meetings) {
    ids.add(meeting.hostId.toString());
    for (const participant of meeting.participants) ids.add(participant.userId.toString());
  }
  const users = await User.find({ _id: { $in: [...ids] } }).select('name avatarUrl');
  return new Map(users.map((user) => [user._id.toString(), user]));
}

async function buildMeetingView(meeting: MeetingDocument): Promise<MeetingView> {
  return viewFrom(meeting, await loadPeople([meeting]));
}

function viewFrom(meeting: MeetingDocument, byId: UserLookup): MeetingView {
  const host = byId.get(meeting.hostId.toString());

  const participants = meeting.participants.flatMap((participant) => {
    const user = byId.get(participant.userId.toString());
    // A participant whose account was deleted is dropped rather than rendered
    // as a half-empty row.
    if (!user) return [];

    return [
      {
        userId: user._id.toString(),
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
        joinedAt: participant.joinedAt.toISOString(),
        leftAt: participant.leftAt ? participant.leftAt.toISOString() : null,
      },
    ];
  });

  const durationSec =
    meeting.startedAt && meeting.endedAt
      ? Math.round((meeting.endedAt.getTime() - meeting.startedAt.getTime()) / 1000)
      : null;

  return meetingSchema.omit({ isHost: true }).parse({
    id: meeting._id.toString(),
    teamId: meeting.teamId.toString(),
    title: meeting.title,
    description: meeting.description ?? null,
    hostId: meeting.hostId.toString(),
    hostName: host?.name ?? 'Unknown host',
    status: meeting.status,
    roomCode: meeting.roomCode,
    scheduledAt: meeting.scheduledAt ? meeting.scheduledAt.toISOString() : null,
    startedAt: meeting.startedAt ? meeting.startedAt.toISOString() : null,
    endedAt: meeting.endedAt ? meeting.endedAt.toISOString() : null,
    durationSec,
    participants,
    recording: meeting.recording?.url
      ? {
          url: meeting.recording.url,
          publicId: meeting.recording.publicId ?? '',
          durationSec: meeting.recording.durationSec ?? 0,
          status: meeting.recording.status ?? 'none',
        }
      : null,
    aiStatus: meeting.aiStatus,
    createdAt: meeting.createdAt.toISOString(),
  });
}

/**
 * Loads a meeting the user is allowed to see, enforcing team membership.
 *
 * Every meeting-scoped operation funnels through here, so a new endpoint
 * cannot accidentally skip the check.
 */
export async function getMeetingForMember(
  meetingId: string,
  userId: string,
): Promise<MeetingDocument> {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw AppError.notFound('Meeting not found');

  await assertTeamMember(meeting.teamId.toString(), userId);
  return meeting;
}

/** Same, but additionally requires the caller to be the meeting's host. */
export async function getMeetingForHost(
  meetingId: string,
  userId: string,
): Promise<MeetingDocument> {
  const meeting = await getMeetingForMember(meetingId, userId);

  if (meeting.hostId.toString() !== userId) {
    // The caller is a team member, so the meeting's existence is not secret
    // from them: 403 is accurate and more useful than 404.
    throw AppError.forbidden('Only the meeting host can do that');
  }

  return meeting;
}

export async function createMeeting(
  input: CreateMeetingInput,
  hostId: string,
): Promise<MeetingDto> {
  await assertTeamMember(input.teamId, hostId);

  // No `scheduledAt` means "start now": the meeting is created already live,
  // which is the one-click flow from the dashboard. Its presence is the only
  // difference between the scheduled and start-now paths.
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;

  const meeting = await Meeting.create({
    teamId: new Types.ObjectId(input.teamId),
    title: input.title,
    description: input.description ?? null,
    hostId: new Types.ObjectId(hostId),
    roomCode: await generateRoomCode(),
    status: scheduledAt ? 'scheduled' : 'live',
    scheduledAt,
    startedAt: scheduledAt ? null : new Date(),
  });

  return toMeetingDto(meeting, hostId);
}

/**
 * The order each filter reads most naturally in. Upcoming meetings are a
 * schedule, so soonest first; live and past meetings are history, so most
 * recent first. `_id` breaks ties, so page boundaries are stable.
 */
const SORT_BY_STATUS = {
  all: { createdAt: -1, _id: -1 },
  scheduled: { scheduledAt: 1, _id: 1 },
  live: { startedAt: -1, _id: -1 },
  ended: { endedAt: -1, _id: -1 },
} as const;

/**
 * The meeting history: filtered by status, ordered for that status, and with
 * `q` ranked by relevance across titles, summaries and transcripts.
 */
export async function listMeetings(query: ListMeetingsQuery, userId: string): Promise<MeetingList> {
  // Scope to the teams the user actually belongs to. Passing an explicit
  // teamId narrows further but can never widen beyond this set.
  const teamIds = await myTeamIds(userId);

  if (query.teamId) {
    await assertTeamMember(query.teamId, userId);
  }

  const scope: Record<string, unknown> = {
    teamId: query.teamId ? new Types.ObjectId(query.teamId) : { $in: teamIds },
  };
  if (query.status) scope.status = query.status;

  const skip = (query.page - 1) * query.limit;

  if (query.q) {
    const ranked = await rankMeetings(query.q, scope);
    const pageIds = ranked.slice(skip, skip + query.limit).map((hit) => hit.id);
    const docs = await Meeting.find({ _id: { $in: pageIds } });
    const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));

    return {
      meetings: await toListItems(
        pageIds.flatMap((id) => byId.get(id) ?? []),
        userId,
        query.q,
      ),
      total: ranked.length,
      page: query.page,
      limit: query.limit,
    };
  }

  // countDocuments runs alongside the page query rather than after it.
  const [docs, total] = await Promise.all([
    Meeting.find(scope)
      .sort(SORT_BY_STATUS[query.status ?? 'all'])
      .skip(skip)
      .limit(query.limit),
    Meeting.countDocuments(scope),
  ]);

  return {
    meetings: await toListItems(docs, userId, null),
    total,
    page: query.page,
    limit: query.limit,
  };
}

/** A page of meetings as history rows: the DTO, its summary preview, and why it matched. */
async function toListItems(
  meetings: MeetingDocument[],
  viewerId: string,
  q: string | null,
): Promise<MeetingListItem[]> {
  const [people, previews, matches] = await Promise.all([
    loadPeople(meetings),
    loadPreviews(meetings.map((meeting) => meeting._id)),
    q ? describeMatches(meetings, q) : Promise.resolve(new Map<string, MeetingSearchMatch>()),
  ]);

  return meetings.map((meeting) => {
    const id = meeting._id.toString();
    return {
      ...withViewer(viewFrom(meeting, people), viewerId),
      preview: previews.get(id) ?? null,
      match: matches.get(id) ?? null,
    };
  });
}

/**
 * Reads a meeting, served from Redis when warm.
 *
 * Note what is *not* cached: the team-membership check runs against MongoDB on
 * every call. Caching an authorisation decision would mean a member removed
 * from a team kept access until the TTL expired, which is exactly the kind of
 * staleness that must never be traded for latency. A cache hit therefore turns
 * a `findById` plus an `$in` over every participant into one indexed
 * `Team.exists`.
 */
export async function getMeeting(meetingId: string, userId: string): Promise<MeetingDto> {
  const view = await cached(cacheKeys.meeting(meetingId), DEFAULT_TTL_SEC, async () => {
    const meeting = await Meeting.findById(meetingId);
    if (!meeting) throw AppError.notFound('Meeting not found');
    return buildMeetingView(meeting);
  });

  if (!view) throw AppError.notFound('Meeting not found');

  await assertTeamMember(view.teamId, userId);
  return withViewer(view, userId);
}

/**
 * Resolves a room code to a meeting.
 *
 * This is the "join by link" path, so it is deliberately still membership
 * checked: a code is a convenience for people who already have access, not a
 * capability that grants it. An ended meeting is rejected here rather than in
 * the UI, so a stale link gives a clear answer.
 */
export async function getMeetingByCode(roomCode: string, userId: string): Promise<MeetingDto> {
  const code = roomCode.toUpperCase();

  // The hottest lookup in the product: every join and every shared link hits
  // it, often several times as a lobby re-checks before connecting.
  const view = await cached(cacheKeys.meetingByCode(code), DEFAULT_TTL_SEC, async () => {
    const meeting = await Meeting.findOne({ roomCode: code });
    if (!meeting) throw AppError.notFound('No meeting found for that code');
    return buildMeetingView(meeting);
  });

  if (!view) throw AppError.notFound('No meeting found for that code');

  await assertTeamMember(view.teamId, userId);

  if (view.status === 'ended') {
    throw AppError.conflict('That meeting has already ended');
  }

  return withViewer(view, userId);
}

export async function updateMeeting(
  meetingId: string,
  userId: string,
  input: UpdateMeetingInput,
): Promise<MeetingDto> {
  const meeting = await getMeetingForHost(meetingId, userId);

  if (meeting.status === 'ended') {
    throw AppError.conflict('An ended meeting can no longer be edited');
  }

  if (input.title !== undefined) meeting.title = input.title;
  if (input.description !== undefined) meeting.description = input.description;
  if (input.scheduledAt !== undefined) {
    meeting.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  }

  await meeting.save();
  await invalidateMeeting(meeting);

  return toMeetingDto(meeting, userId);
}

/**
 * Outcome of a start request.
 *
 * `started` distinguishes "this call took the meeting live" from "it was
 * already live", which the idempotent path below makes indistinguishable from
 * the returned DTO alone. The caller needs that to decide whether to notify
 * the team: a double-clicked Start button must not notify twice.
 */
export interface StartMeetingResult {
  meeting: MeetingDto;
  started: boolean;
}

export async function startMeeting(meetingId: string, userId: string): Promise<StartMeetingResult> {
  const meeting = await getMeetingForHost(meetingId, userId);

  if (meeting.status === 'ended') throw AppError.conflict('That meeting has already ended');

  // Idempotent: starting a live meeting is a no-op rather than an error, so a
  // double-click or a retried request does not surface a scary message.
  const started = meeting.status === 'scheduled';

  if (started) {
    meeting.status = 'live';
    meeting.startedAt = new Date();
    await meeting.save();
    await invalidateMeeting(meeting);
  }

  return { meeting: await toMeetingDto(meeting, userId), started };
}

export async function endMeeting(meetingId: string, userId: string): Promise<MeetingDto> {
  const meeting = await getMeetingForHost(meetingId, userId);

  if (meeting.status !== 'ended') {
    meeting.status = 'ended';
    meeting.endedAt = new Date();

    // Close out anyone the socket layer never saw leave - a browser killed
    // mid-meeting never fires a disconnect we can trust.
    for (const participant of meeting.participants) {
      participant.leftAt ??= meeting.endedAt;
    }

    await meeting.save();
    await invalidateMeeting(meeting);
    // An ended meeting is when it starts counting in the team's analytics.
    await invalidateTeamAnalytics([meeting.teamId]);
  }

  return toMeetingDto(meeting, userId);
}

export async function deleteMeeting(meetingId: string, userId: string): Promise<void> {
  const meeting = await getMeetingForHost(meetingId, userId);

  if (meeting.status === 'live') {
    throw AppError.conflict('End the meeting before deleting it');
  }

  await deleteMeetingArtifacts([meeting]);
  await meeting.deleteOne();
  await invalidateMeeting(meeting);
  await invalidateTeamAnalytics([meeting.teamId]);
}

/**
 * Removes everything that hangs off these meetings: chat, transcripts,
 * insights, notifications that link to them, and their recordings, on local
 * disk or on Cloudinary. Tasks made from them stay, unlinked.
 *
 * Shared by host deletion, the demo cleanup (guests included) and the seeded
 * history's retirement, so none of them can forget a collection that a later
 * phase adds. A notification pointing at a deleted meeting would open
 * "Meeting not found", so those go too. A recording must not outlive its
 * meeting: on Cloudinary it would stay playable by anyone with its URL. A
 * Cloudinary failure is logged, never thrown (destroyCloudinaryRecordings).
 */
export async function deleteMeetingArtifacts(
  meetings: Pick<MeetingDocument, '_id' | 'recording'>[],
): Promise<void> {
  if (meetings.length === 0) return;

  const ids = meetings.map((meeting) => meeting._id);
  await Promise.all([
    Message.deleteMany({ meetingId: { $in: ids } }),
    Transcript.deleteMany({ meetingId: { $in: ids } }),
    MeetingInsight.deleteMany({ meetingId: { $in: ids } }),
    // The payload stores ids as strings (it is free-form JSON).
    Notification.deleteMany({ 'payload.meetingId': { $in: ids.map((id) => id.toString()) } }),
    // Tasks made from the meeting's action items are work in their own right
    // and stay on the board; only the link to a meeting that is gone goes.
    Task.updateMany(
      { sourceMeetingId: { $in: ids } },
      { $set: { sourceMeetingId: null, sourceActionItemId: null }, $inc: { version: 1 } },
    ),
  ]);

  await Promise.all(
    meetings.map((meeting) =>
      meeting.recording?.storage === 'local' && meeting.recording.publicId
        ? deleteLocalRecording(meeting.recording.publicId)
        : Promise.resolve(),
    ),
  );

  await destroyCloudinaryRecordings(
    meetings.flatMap((meeting) =>
      meeting.recording?.storage === 'cloudinary' && meeting.recording.publicId
        ? [{ meetingId: meeting._id.toString(), publicId: meeting.recording.publicId }]
        : [],
    ),
  );
}

/**
 * Records that a user joined a meeting.
 *
 * Called from the socket layer on `room:join`. Re-joining (a reconnect, or a
 * second tab) reopens the existing row rather than appending a duplicate, so
 * the attendance list stays one entry per person.
 */
export async function recordParticipantJoin(meetingId: string, userId: string): Promise<void> {
  const now = new Date();
  const existing = await Meeting.findOne({
    _id: meetingId,
    'participants.userId': userId,
  }).select('_id');

  // Both paths stamp `lastActiveAt`: somebody is in the room right now, which
  // is what keeps the abandoned-meeting sweep away from it.
  if (existing) {
    await Meeting.updateOne(
      { _id: meetingId, 'participants.userId': userId },
      { $set: { 'participants.$.leftAt': null, lastActiveAt: now } },
    );
    return;
  }

  await Meeting.updateOne(
    { _id: meetingId },
    {
      $push: { participants: { userId: new Types.ObjectId(userId), joinedAt: now } },
      $set: { lastActiveAt: now },
    },
  );
}

export async function recordParticipantLeave(meetingId: string, userId: string): Promise<void> {
  const now = new Date();
  // Somebody was in the room until this moment. When they were the last one,
  // this is when the idle clock starts.
  await Meeting.updateOne(
    { _id: meetingId, 'participants.userId': userId },
    { $set: { 'participants.$.leftAt': now, lastActiveAt: now } },
  );
}

/** Drops every cached view of a meeting. Called after any write. */
export async function invalidateMeeting(meeting: MeetingDocument): Promise<void> {
  await cacheDel(
    cacheKeys.meeting(meeting._id.toString()),
    cacheKeys.meetingByCode(meeting.roomCode),
  );
}
