import { Link } from 'react-router-dom';
import { CalendarClock, Clock, ListChecks, Radio, Scale, Users, Video } from 'lucide-react';
import type { MeetingListItem } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatOffset } from './aiStatus';
import { AiStatusBadge } from './AiStatusBadge';
import { formatDateTime, formatMinutes, meetingWhen } from './format';
import { Highlight } from './Highlight';

const SOURCE_LABEL = {
  summary: 'Summary',
  decision: 'Decision',
  transcript: 'Transcript',
  description: 'Description',
  title: 'Title',
} as const;

function StatusBadge({ status }: { status: MeetingListItem['status'] }) {
  if (status === 'live') {
    return (
      <Badge variant="success">
        <Radio aria-hidden="true" className="animate-pulse motion-reduce:animate-none" />
        Live
      </Badge>
    );
  }
  if (status === 'scheduled') {
    return (
      <Badge variant="secondary">
        <CalendarClock aria-hidden="true" />
        Upcoming
      </Badge>
    );
  }
  return <Badge variant="outline">Ended</Badge>;
}

/**
 * One meeting in the history.
 *
 * A search result shows *why* it matched - the summary sentence or the
 * transcript line, with the searched words marked - and a transcript match
 * links straight to that moment. Otherwise a past meeting shows the start of
 * its summary, which is what tells one Tuesday stand-up from the next.
 */
export function HistoryRow({ meeting, query }: { meeting: MeetingListItem; query: string }) {
  const { match, preview } = meeting;
  const page = `/app/meetings/${meeting.id}`;
  // A title match is already visible, highlighted, in the heading.
  const showMatch = match && match.source !== 'title';

  const jumpTo =
    match?.source === 'transcript' && match.offsetSec !== null
      ? `${page}?${new URLSearchParams({
          tab: 'transcript',
          t: String(Math.floor(match.offsetSec)),
          q: query,
        }).toString()}`
      : null;

  return (
    <li>
      <article className="rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug">
            <Link to={page} className="hover:underline focus-visible:underline">
              <Highlight text={meeting.title} query={query} />
            </Link>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={meeting.status} />
            <AiStatusBadge status={meeting.aiStatus} />
          </div>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{formatDateTime(meetingWhen(meeting), 'Not scheduled')}</span>
          {meeting.durationSec !== null && (
            <span className="flex items-center gap-1">
              <Clock aria-hidden="true" className="size-3.5" />
              {formatMinutes(meeting.durationSec)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users aria-hidden="true" className="size-3.5" />
            {meeting.participants.length > 0
              ? `${meeting.participants.length} attended`
              : `Host: ${meeting.hostName}`}
          </span>
        </p>

        {showMatch ? (
          <p className="mt-3 border-l-2 border-primary/40 pl-3 text-sm">
            <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {SOURCE_LABEL[match.source]}
              {match.offsetSec !== null && ` ${formatOffset(match.offsetSec)}`}
            </span>
            <Highlight text={match.snippet} query={query} />
          </p>
        ) : (
          preview && (
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
              <Highlight text={preview.summary} query={query} />
            </p>
          )
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {preview && (
            <>
              <span className="flex items-center gap-1">
                <Scale aria-hidden="true" className="size-3.5" />
                {preview.keyDecisionCount}{' '}
                {preview.keyDecisionCount === 1 ? 'decision' : 'decisions'}
              </span>
              <span className="flex items-center gap-1">
                <ListChecks aria-hidden="true" className="size-3.5" />
                {preview.actionItemCount}{' '}
                {preview.actionItemCount === 1 ? 'action item' : 'action items'}
                {preview.actionItemCount > 0 && `, ${preview.openActionItemCount} open`}
              </span>
            </>
          )}
          <span className="ml-auto flex flex-wrap gap-2">
            {jumpTo && match && (
              <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <Link
                  to={jumpTo}
                  aria-label={`Open the transcript of ${meeting.title} at ${formatOffset(match.offsetSec ?? 0)}`}
                >
                  Jump to {formatOffset(match.offsetSec ?? 0)}
                </Link>
              </Button>
            )}
            {meeting.status === 'live' && (
              <Button asChild size="sm" className="h-7 px-2 text-xs">
                <Link to={`/app/room/${meeting.roomCode}`}>
                  <Video aria-hidden="true" />
                  Join
                </Link>
              </Button>
            )}
          </span>
        </div>
      </article>
    </li>
  );
}
