import { useCallback, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Mic,
  RotateCw,
  Users,
  Video,
} from 'lucide-react';
import type { AiStatusEvent, Meeting, MeetingIntelligence } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { AiStatusBadge } from './AiStatusBadge';
import { aiKeys, getMeetingIntelligence, retryAiProcessing } from './ai.api';
import { AI_STEPS, isAiInProgress } from './aiStatus';
import { ActionItemsTab } from './detail/ActionItemsTab';
import { ChatLogTab } from './detail/ChatLogTab';
import { ExportMenu } from './detail/ExportMenu';
import { RecordingTab } from './detail/RecordingTab';
import { SummaryTab } from './detail/SummaryTab';
import { TranscriptTab } from './detail/TranscriptTab';
import { useRecordingSource } from './detail/useRecordingSource';
import { buildExportModel, hasExportableContent } from './export/meetingExport';
import { formatDateTime, formatMinutes, meetingWhen } from './format';
import { getMeeting, meetingKeys } from './meetings.api';
import { useAiStatusUpdates } from './useAiStatusUpdates';

const TABS = ['summary', 'actions', 'transcript', 'chat', 'recording'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return (TABS as readonly string[]).includes(value ?? '');
}

/**
 * One meeting, after the fact: summary, action items, transcript, chat and
 * recording, each on its own tab.
 *
 * Tabs rather than one long page, because the transcript can be an hour long
 * and everything below it would be out of reach on a phone. The open tab
 * lives in the URL (`?tab=transcript&t=252&q=pricing`), so a search result
 * can link straight to a line of the transcript, and Back works.
 *
 * AI progress still arrives live over the socket, so the page walks from
 * "Transcribing" to the finished summary on its own.
 */
export function MeetingDetailPage() {
  const { meetingId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const requestedTab = searchParams.get('tab');
  const tab: Tab = isTab(requestedTab) ? requestedTab : 'summary';
  const seconds = Number(searchParams.get('t'));
  const initialTime = searchParams.has('t') && Number.isFinite(seconds) ? seconds : null;
  const initialQuery = searchParams.get('q') ?? '';

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
          <Link to="/app/meetings">Back to all meetings</Link>
        </Button>
      </div>
    );
  }

  function selectTab(next: string) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        params.set('tab', next);
        // A deep link's timestamp belongs to the visit that followed it.
        params.delete('t');
        return params;
      },
      { replace: true },
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/app/meetings">
          <ArrowLeft aria-hidden="true" />
          All meetings
        </Link>
      </Button>

      <MeetingHeader
        meeting={meeting.data}
        intelligence={intelligence.data}
        aiStatus={intelligence.data?.aiStatus ?? meeting.data.aiStatus}
      />

      {intelligence.isPending && <Skeleton className="h-48 w-full" />}
      {intelligence.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the summary for this meeting.
        </p>
      )}
      {intelligence.data && (
        <>
          <PipelineStatus
            meeting={meeting.data}
            intelligence={intelligence.data}
            onRetry={() => retry.mutate()}
            retrying={retry.isPending}
          />
          <MeetingTabs
            meeting={meeting.data}
            intelligence={intelligence.data}
            tab={tab}
            onTabChange={selectTab}
            initialQuery={initialQuery}
            initialTime={initialTime}
          />
        </>
      )}
    </div>
  );
}

function MeetingHeader({
  meeting,
  intelligence,
  aiStatus,
}: {
  meeting: Meeting;
  intelligence: MeetingIntelligence | undefined;
  aiStatus: Meeting['aiStatus'];
}) {
  const model = useMemo(() => buildExportModel(meeting, intelligence), [meeting, intelligence]);

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight">{meeting.title}</h1>
        {meeting.status === 'live' && <Badge variant="success">Live</Badge>}
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
          <dd>{formatDateTime(meetingWhen(meeting))}</dd>
        </div>
        {meeting.durationSec !== null && (
          <div className="flex items-center gap-1.5">
            <dt>
              <Clock aria-hidden="true" className="size-4" />
              <span className="sr-only">Duration</span>
            </dt>
            <dd>{formatMinutes(meeting.durationSec)}</dd>
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

      <div className="flex flex-wrap gap-2">
        {meeting.status === 'live' && (
          <Button asChild size="sm">
            <Link to={`/app/room/${meeting.roomCode}`}>
              <Video aria-hidden="true" />
              Open the meeting room
            </Link>
          </Button>
        )}
        {hasExportableContent(model) && <ExportMenu model={model} />}
      </div>
    </header>
  );
}

/** What the pipeline is doing, when it is doing anything worth saying. */
function PipelineStatus({
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
  const { aiStatus } = intelligence;

  if (isAiInProgress(aiStatus)) return <Progress status={aiStatus} />;

  if (aiStatus === 'failed') {
    return (
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
    );
  }

  if (aiStatus === 'none' && !intelligence.insight) return <NoRecording meeting={meeting} />;

  return null;
}

function MeetingTabs({
  meeting,
  intelligence,
  tab,
  onTabChange,
  initialQuery,
  initialTime,
}: {
  meeting: Meeting;
  intelligence: MeetingIntelligence;
  tab: Tab;
  onTabChange: (tab: string) => void;
  initialQuery: string;
  initialTime: number | null;
}) {
  const { insight, transcript } = intelligence;
  // Only the tabs that play audio pay for downloading it.
  const source = useRecordingSource(meeting, tab === 'transcript' || tab === 'recording');
  const openItems = insight?.actionItems.filter((item) => item.status !== 'done').length ?? 0;
  const pending = isAiInProgress(intelligence.aiStatus);

  return (
    <Tabs value={tab} onValueChange={onTabChange} className="space-y-4">
      {/* Wraps onto a second row on a phone rather than scrolling sideways,
          so no tab is ever hidden off-screen. */}
      <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
        <TabsTrigger value="summary" className="flex-none">
          Summary
        </TabsTrigger>
        <TabsTrigger value="actions" className="flex-none">
          {/* The space keeps the accessible name "Action items 2 open"; flex
              layout drops it visually. */}
          Action items{' '}
          {openItems > 0 && (
            <Badge variant="secondary" className="px-1.5">
              {openItems}
              <span className="sr-only"> open</span>
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="transcript" className="flex-none">
          Transcript
        </TabsTrigger>
        <TabsTrigger value="chat" className="flex-none">
          Chat
        </TabsTrigger>
        <TabsTrigger value="recording" className="flex-none">
          Recording
        </TabsTrigger>
      </TabsList>

      <TabsContent value="summary">
        {insight ? (
          <SummaryTab meeting={meeting} insight={insight} />
        ) : (
          <EmptyTab pending={pending}>The summary and key decisions appear here.</EmptyTab>
        )}
      </TabsContent>
      <TabsContent value="actions">
        {insight ? (
          <ActionItemsTab meeting={meeting} insight={insight} />
        ) : (
          <EmptyTab pending={pending}>Action items and their owners appear here.</EmptyTab>
        )}
      </TabsContent>
      <TabsContent value="transcript">
        {transcript ? (
          <TranscriptTab
            meeting={meeting}
            transcript={transcript}
            source={source}
            initialQuery={initialQuery}
            initialTime={initialTime}
          />
        ) : (
          <EmptyTab pending={pending}>The timestamped transcript appears here.</EmptyTab>
        )}
      </TabsContent>
      <TabsContent value="chat">
        <ChatLogTab meetingId={meeting.id} />
      </TabsContent>
      <TabsContent value="recording">
        <RecordingTab meeting={meeting} source={source} />
      </TabsContent>
    </Tabs>
  );
}

function EmptyTab({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
      {pending ? 'Still processing. ' : 'Nothing yet. '}
      {children}
    </p>
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
