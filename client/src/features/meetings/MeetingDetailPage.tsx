import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  ListChecks,
  Loader2,
  Mic,
  RotateCw,
  Scale,
  ScrollText,
  Sparkles,
  Users,
} from 'lucide-react';
import type { AiStatusEvent, Meeting, MeetingIntelligence } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { AiStatusBadge } from './AiStatusBadge';
import { aiKeys, getMeetingIntelligence, retryAiProcessing } from './ai.api';
import { AI_STEPS, formatOffset, isAiInProgress } from './aiStatus';
import { getMeeting, meetingKeys } from './meetings.api';
import { useAiStatusUpdates } from './useAiStatusUpdates';

function formatDate(iso: string | null): string {
  if (!iso) return 'Not started';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "Fri 18 Sep" - a due date, not a timestamp, so no time and no time zone shift. */
function formatDue(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * One meeting's AI output: summary, decisions, action items and transcript.
 *
 * Phase 6 needs somewhere to show what the pipeline produced; Phase 7 turns
 * this into the full history view with tabs, search, editing and export.
 * Progress arrives live over the socket, so the page walks from "Transcribing"
 * to the finished summary on its own.
 */
export function MeetingDetailPage() {
  const { meetingId = '' } = useParams();
  const queryClient = useQueryClient();

  const meeting = useQuery({
    queryKey: meetingKeys.detail(meetingId),
    queryFn: () => getMeeting(meetingId),
    enabled: Boolean(meetingId),
    retry: false,
  });

  const intelligence = useQuery({
    queryKey: aiKeys.intelligence(meetingId),
    queryFn: () => getMeetingIntelligence(meetingId),
    enabled: Boolean(meetingId),
    retry: false,
  });

  const onStatus = useCallback(
    (event: AiStatusEvent) => {
      if (event.meetingId !== meetingId) return;
      if (event.status === 'done') toast.success('The summary is ready');
    },
    [meetingId],
  );
  useAiStatusUpdates(onStatus);

  const retry = useMutation({
    mutationFn: () => retryAiProcessing(meetingId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: aiKeys.intelligence(meetingId) });
      toast.success('Processing again');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not retry'),
  });

  if (meeting.isPending) {
    return (
      <div aria-live="polite" className="mx-auto w-full max-w-4xl space-y-4">
        <span className="sr-only">Loading the meeting</span>
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (meeting.isError) {
    const notFound = meeting.error instanceof ApiError && meeting.error.status === 404;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle aria-hidden="true" className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {notFound ? 'Meeting not found' : 'Could not load the meeting'}
        </h1>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/app">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }

  const data = meeting.data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/app">
          <ArrowLeft aria-hidden="true" />
          Dashboard
        </Link>
      </Button>

      <MeetingHeader meeting={data} aiStatus={intelligence.data?.aiStatus ?? data.aiStatus} />

      {intelligence.isPending && <Skeleton className="h-48 w-full" />}
      {intelligence.isError && (
        <p className="text-sm text-destructive">Could not load the summary for this meeting.</p>
      )}
      {intelligence.data && (
        <AiSections
          meeting={data}
          intelligence={intelligence.data}
          onRetry={() => retry.mutate()}
          retrying={retry.isPending}
        />
      )}
    </div>
  );
}

function MeetingHeader({ meeting, aiStatus }: { meeting: Meeting; aiStatus: Meeting['aiStatus'] }) {
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{meeting.title}</h1>
        <AiStatusBadge status={aiStatus} />
      </div>
      {meeting.description && (
        <p className="text-sm text-muted-foreground">{meeting.description}</p>
      )}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <dt>
            <CalendarDays aria-hidden="true" className="size-4" />
            <span className="sr-only">Date</span>
          </dt>
          <dd>{formatDate(meeting.startedAt ?? meeting.scheduledAt)}</dd>
        </div>
        {meeting.durationSec !== null && (
          <div className="flex items-center gap-1.5">
            <dt>
              <Clock aria-hidden="true" className="size-4" />
              <span className="sr-only">Duration</span>
            </dt>
            <dd>{Math.max(1, Math.round(meeting.durationSec / 60))} min</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <dt>
            <Users aria-hidden="true" className="size-4" />
            <span className="sr-only">Participants</span>
          </dt>
          <dd>
            {meeting.participants.length > 0
              ? meeting.participants.map((participant) => participant.name).join(', ')
              : `Hosted by ${meeting.hostName}`}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function AiSections({
  meeting,
  intelligence,
  onRetry,
  retrying,
}: {
  meeting: Meeting;
  intelligence: MeetingIntelligence;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { aiStatus, insight, transcript } = intelligence;

  return (
    <div className="space-y-6">
      {aiStatus === 'none' && !insight && <NoRecording meeting={meeting} />}
      {isAiInProgress(aiStatus) && <Progress status={aiStatus} />}
      {aiStatus === 'failed' && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle aria-hidden="true" className="size-5" />
              The summary could not be generated
            </CardTitle>
            <CardDescription role="alert">
              {intelligence.aiError ?? 'Processing failed.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {meeting.isHost ? (
              <Button onClick={onRetry} disabled={retrying}>
                {retrying ? (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                ) : (
                  <RotateCw aria-hidden="true" />
                )}
                Retry
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">The host can retry from this page.</p>
            )}
          </CardContent>
        </Card>
      )}

      {insight && (
        <>
          <section aria-labelledby="summary-heading" className="rounded-xl border bg-card p-5">
            <h2 id="summary-heading" className="flex items-center gap-2 font-semibold">
              <Sparkles aria-hidden="true" className="size-4 text-primary" />
              Summary
            </h2>
            <p className="mt-2 text-sm leading-relaxed">{insight.summary}</p>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section aria-labelledby="decisions-heading" className="rounded-xl border bg-card p-5">
              <h2 id="decisions-heading" className="flex items-center gap-2 font-semibold">
                <Scale aria-hidden="true" className="size-4 text-primary" />
                Key decisions
              </h2>
              {insight.keyDecisions.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No decisions were recorded.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
                  {insight.keyDecisions.map((decision) => (
                    <li key={decision}>{decision}</li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="actions-heading" className="rounded-xl border bg-card p-5">
              <h2 id="actions-heading" className="flex items-center gap-2 font-semibold">
                <ListChecks aria-hidden="true" className="size-4 text-primary" />
                Action items
              </h2>
              {insight.actionItems.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No action items were assigned.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {insight.actionItems.map((item, index) => (
                    <li key={`${index}-${item.text}`} className="text-sm">
                      <p>{item.text}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {item.assigneeName ? (
                          <Badge variant={item.assigneeId ? 'secondary' : 'outline'}>
                            {item.assigneeName}
                            {/* A name the model heard that matches nobody in
                                the meeting: shown, but flagged for the host. */}
                            {!item.assigneeId && ' (not a participant)'}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Unassigned</Badge>
                        )}
                        {item.dueDate && <span>Due {formatDue(item.dueDate)}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      {transcript && (
        <section aria-labelledby="transcript-heading" className="rounded-xl border bg-card p-5">
          <h2 id="transcript-heading" className="flex items-center gap-2 font-semibold">
            <ScrollText aria-hidden="true" className="size-4 text-primary" />
            Transcript
          </h2>
          <ol className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-2 text-sm">
            {transcript.segments.map((segment, index) => (
              <li key={`${index}-${segment.start}`} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                  {formatOffset(segment.start)}
                </span>
                <p className="min-w-0">
                  {segment.speaker && <span className="font-medium">{segment.speaker}: </span>}
                  {segment.text}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Generated by {insight?.provider ?? transcript.provider}. AI output can be wrong; check
            owners and dates before acting on them.
          </p>
        </section>
      )}
    </div>
  );
}

function NoRecording({ meeting }: { meeting: Meeting }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic aria-hidden="true" className="size-5 text-muted-foreground" />
          No recording
        </CardTitle>
        <CardDescription>
          {meeting.status === 'live' && meeting.isHost
            ? 'Press Record in the meeting room. When you stop, the transcript, summary and action items appear here.'
            : 'The summary appears here after the host records the meeting.'}
        </CardDescription>
      </CardHeader>
      {meeting.status === 'live' && (
        <CardContent>
          <Button asChild variant="outline">
            <Link to={`/app/room/${meeting.roomCode}`}>Open the meeting room</Link>
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * The pipeline's steps, with the current one spinning. A live region, so the
 * move from one step to the next is announced, not only drawn.
 */
function Progress({ status }: { status: Meeting['aiStatus'] }) {
  const current = AI_STEPS.findIndex((step) => step.status === status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preparing the summary</CardTitle>
        <CardDescription>
          This usually takes under a minute. You can leave this page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol aria-live="polite" className="space-y-2 text-sm">
          {AI_STEPS.map((step, index) => {
            const state = index < current ? 'done' : index === current ? 'active' : 'pending';
            return (
              <li
                key={step.status}
                className={cn(
                  'flex items-center gap-2',
                  state === 'pending' && 'text-muted-foreground',
                )}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                {state === 'done' && (
                  <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />
                )}
                {state === 'active' && (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary" />
                )}
                {state === 'pending' && <Circle aria-hidden="true" className="size-4" />}
                {step.label}
                <span className="sr-only">
                  {state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
