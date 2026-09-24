import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarChart3, ChevronDown, Download, FileSpreadsheet } from 'lucide-react';
import {
  ANALYTICS_PRESET_WEEKS,
  type AnalyticsDataset,
  type AnalyticsMember,
  type AnalyticsOverview,
  type AnalyticsWeek,
} from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import { listTeams, teamKeys } from '@/features/teams/teams.api';
import { cn } from '@/lib/utils';
import {
  ActionItemsChart,
  ActivityChart,
  CompletionChart,
  MeetingsChart,
  OutcomesChart,
} from './AnalyticsCharts';
import { ChartCard, type TableColumn } from './ChartCard';
import { completionRows, outcomesOf } from './chartData';
import {
  analyticsKeys,
  downloadAnalyticsCsv,
  getMembers,
  getOverview,
  getWeekly,
  type AnalyticsParams,
} from './analytics.api';
import {
  actionItemsSummary,
  activitySummary,
  completionSummary,
  dayLabel,
  decimal,
  duration,
  meetingsSummary,
  outcomesSummary,
  percent,
  plural,
  weekLabel,
} from './format';
import { useAnalyticsFilters, type AnalyticsFilters } from './useAnalyticsFilters';

/**
 * The analytics dashboard (`/app/analytics`): how much the team meets, who
 * takes part, and how much of what is agreed gets done.
 *
 * One filter row scopes everything below it - the team, and a range of whole
 * weeks (4, 8 or 12, or any dates) in the reader's own time zone - and all of
 * it lives in the URL. Every chart has a one-line summary and a table with
 * its numbers; the CSV exports hold the same tables.
 */
export function AnalyticsPage() {
  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });
  const filters = useAnalyticsFilters(teams.data);
  const params = filters.params;

  const enabled = params !== null;
  // Keeps the last answer on screen while a new range loads, instead of
  // flashing back to skeletons.
  const shared = { enabled, placeholderData: keepPreviousData } as const;
  const overview = useQuery({
    queryKey: analyticsKeys.part('overview', params as AnalyticsParams),
    queryFn: () => getOverview(params as AnalyticsParams),
    ...shared,
  });
  const weekly = useQuery({
    queryKey: analyticsKeys.part('weekly', params as AnalyticsParams),
    queryFn: () => getWeekly(params as AnalyticsParams),
    ...shared,
  });
  const members = useQuery({
    queryKey: analyticsKeys.part('members', params as AnalyticsParams),
    queryFn: () => getMembers(params as AnalyticsParams),
    ...shared,
  });

  const queries = [overview, weekly, members];
  const failed = queries.some((query) => query.isError);
  const loading = queries.some((query) => query.isPending);
  const refreshing = queries.some((query) => query.isPlaceholderData);

  if (teams.data && teams.data.length === 0) {
    return (
      <Page>
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Join or create a team to see its analytics.
        </p>
      </Page>
    );
  }

  return (
    <Page teamName={filters.team?.name}>
      <FilterRow filters={filters} teams={teams.data ?? []} params={params} />

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the analytics.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => queries.forEach((query) => void query.refetch())}
          >
            Try again
          </button>
        </p>
      )}

      {filters.error ? null : loading && !failed ? (
        <div aria-live="polite" className="space-y-4">
          <span className="sr-only">Loading the analytics</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((tile) => (
              <Skeleton key={tile} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : (
        overview.data &&
        weekly.data &&
        members.data && (
          <div
            aria-busy={refreshing}
            className={cn('space-y-4 transition-opacity', refreshing && 'opacity-60')}
          >
            <KpiTiles overview={overview.data} weeks={weekly.data.weeks.length} />

            <ChartCard
              title="Meetings per week"
              summary={meetingsSummary(weekly.data.weeks)}
              columns={WEEK_COLUMNS}
              rows={weekly.data.weeks}
              rowKey={(week) => week.week}
            >
              <MeetingsChart weeks={weekly.data.weeks} />
            </ChartCard>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Action items: raised and done"
                summary={actionItemsSummary(weekly.data.weeks)}
                columns={ITEM_COLUMNS}
                rows={weekly.data.weeks}
                rowKey={(week) => week.week}
              >
                <ActionItemsChart weeks={weekly.data.weeks} />
              </ChartCard>

              <ChartCard
                title="What became of the action items"
                summary={outcomesSummary(overview.data.actionItems)}
                columns={OUTCOME_COLUMNS}
                rows={
                  overview.data.actionItems.created > 0
                    ? outcomesOf(overview.data.actionItems).map((outcome) => ({
                        ...outcome,
                        share: outcome.value / overview.data.actionItems.created,
                      }))
                    : []
                }
                rowKey={(outcome) => outcome.key}
                emptyMessage="No action items were raised in this period."
              >
                <OutcomesChart items={overview.data.actionItems} />
              </ChartCard>

              <ChartCard
                title="Task completion by member"
                summary={completionSummary(members.data.members, overview.data.tasks)}
                columns={COMPLETION_COLUMNS}
                rows={completionRows(members.data.members)}
                rowKey={(member) => member.userId}
                emptyMessage="Nobody was given a task in this period."
              >
                <CompletionChart members={members.data.members} />
              </ChartCard>

              <ChartCard
                title="Most active members"
                summary={activitySummary(members.data.members)}
                columns={ACTIVITY_COLUMNS}
                rows={members.data.members.filter((member) => member.activity > 0)}
                rowKey={(member) => member.userId}
                emptyMessage="Nobody took part in a meeting or finished a task in this period."
              >
                <ActivityChart members={members.data.members} />
              </ChartCard>
            </div>

            <p className="text-xs text-muted-foreground">
              As of{' '}
              {new Date(overview.data.generatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              . Meetings count once they have ended and someone joined; an action item is done when
              it is ticked off or its task is in a Done column.
            </p>
          </div>
        )
      )}
    </Page>
  );
}

function Page({ teamName, children }: { teamName?: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BarChart3 aria-hidden="true" className="size-6 text-primary" />
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Meeting time, attendance and follow-through
          {teamName ? ` for ${teamName}` : ''}.
        </p>
      </header>
      {children}
    </div>
  );
}

// --- Filters ---------------------------------------------------------------------------

function FilterRow({
  filters,
  teams,
  params,
}: {
  filters: AnalyticsFilters;
  teams: { id: string; name: string }[];
  params: AnalyticsParams | null;
}) {
  const [exporting, setExporting] = useState<AnalyticsDataset | null>(null);

  async function exportCsv(dataset: AnalyticsDataset) {
    if (!params) return;
    setExporting(dataset);
    try {
      const name = await downloadAnalyticsCsv(params, dataset);
      toast.success(`Downloaded ${name}`);
    } catch {
      toast.error('The export could not be created. Please try again.');
    } finally {
      setExporting(null);
    }
  }

  return (
    <div
      role="group"
      aria-label="Filters"
      className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border bg-card p-3"
    >
      {teams.length > 1 && (
        <div className="w-full sm:w-56">
          <Label htmlFor="analytics-team" className="mb-1.5 text-xs text-muted-foreground">
            Team
          </Label>
          <NativeSelect
            id="analytics-team"
            value={filters.team?.id ?? ''}
            onChange={(event) => filters.setTeam(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div>
        <span id="analytics-preset" className="mb-1.5 block text-xs text-muted-foreground">
          Period
        </span>
        <div
          role="group"
          aria-labelledby="analytics-preset"
          className="inline-flex gap-1 rounded-lg bg-muted p-1"
        >
          {ANALYTICS_PRESET_WEEKS.map((weeks) => (
            <button
              key={weeks}
              type="button"
              aria-pressed={filters.preset === weeks}
              onClick={() => filters.setPreset(weeks)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                filters.preset === weeks && 'bg-background text-foreground shadow-sm',
              )}
            >
              {weeks} weeks
            </button>
          ))}
        </div>
      </div>

      <div className="flex w-full gap-2 sm:w-auto">
        <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
          <Label htmlFor="analytics-from" className="mb-1.5 text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="analytics-from"
            type="date"
            value={filters.from}
            max={filters.to}
            aria-invalid={Boolean(filters.error)}
            aria-describedby={filters.error ? 'analytics-range-error' : undefined}
            onChange={(event) => {
              if (event.target.value)
                filters.setRange({ from: event.target.value, to: filters.to });
            }}
          />
        </div>
        <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
          <Label htmlFor="analytics-to" className="mb-1.5 text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="analytics-to"
            type="date"
            value={filters.to}
            min={filters.from}
            max={filters.today}
            aria-invalid={Boolean(filters.error)}
            aria-describedby={filters.error ? 'analytics-range-error' : undefined}
            onChange={(event) => {
              if (event.target.value)
                filters.setRange({ from: filters.from, to: event.target.value });
            }}
          />
        </div>
      </div>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!params || exporting !== null}>
              {exporting ? (
                <Spinner label="Preparing the export" />
              ) : (
                <Download aria-hidden="true" />
              )}
              Export CSV
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportCsv('weekly')}>
              <FileSpreadsheet aria-hidden="true" />
              Weekly trends (.csv)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportCsv('members')}>
              <FileSpreadsheet aria-hidden="true" />
              Members (.csv)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="w-full text-xs text-muted-foreground" aria-live="polite">
        {filters.error ? (
          <span id="analytics-range-error" role="alert" className="text-destructive">
            {filters.error}
          </span>
        ) : (
          <>
            {dayLabel(filters.from)} to {dayLabel(filters.to)}, weeks starting Monday ({filters.tz}
            ).
          </>
        )}
      </p>
    </div>
  );
}

// --- KPI tiles -------------------------------------------------------------------------

function KpiTiles({ overview, weeks }: { overview: AnalyticsOverview; weeks: number }) {
  const { meetings, actionItems, tasks } = overview;
  const tiles = [
    {
      label: 'Meetings',
      value: String(meetings.count),
      detail: `in ${plural(weeks, 'week')}`,
    },
    {
      label: 'Time in meetings',
      value: duration(meetings.totalMinutes),
      detail:
        meetings.averageMinutes === null
          ? 'no meetings'
          : `${duration(meetings.averageMinutes)} on average`,
    },
    {
      label: 'Attendance',
      value: decimal(meetings.averageParticipants),
      detail: 'people per meeting',
    },
    {
      label: 'Action items done',
      value: percent(actionItems.created > 0 ? actionItems.completed / actionItems.created : null),
      detail: `${actionItems.completed} of ${actionItems.created}, ${actionItems.overdue} overdue`,
    },
    {
      label: 'Tasks completed',
      value: percent(tasks.completionRate),
      detail: `${tasks.completed} of ${plural(tasks.created, 'task')} created`,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((tile, index) => (
        <div
          key={tile.label}
          className={cn(
            'min-w-0 rounded-xl border bg-card p-4',
            // Five tiles in two columns: the last takes the whole row.
            index === tiles.length - 1 && 'col-span-2 sm:col-span-1',
          )}
        >
          <dt className="text-sm text-muted-foreground">{tile.label}</dt>
          <dd className="mt-1 text-2xl font-semibold">{tile.value}</dd>
          <dd className="mt-0.5 text-xs text-muted-foreground">{tile.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Table columns -----------------------------------------------------------------------

const WEEK_COLUMNS: TableColumn<AnalyticsWeek>[] = [
  { header: 'Week of', cell: (week) => weekLabel(week.week) },
  { header: 'Meetings', cell: (week) => week.meetings, numeric: true },
  { header: 'Time', cell: (week) => duration(week.totalMinutes), numeric: true },
  {
    header: 'Average length',
    cell: (week) => (week.averageMinutes === null ? '–' : duration(week.averageMinutes)),
    numeric: true,
  },
  {
    header: 'People per meeting',
    cell: (week) => decimal(week.averageParticipants),
    numeric: true,
  },
];

const ITEM_COLUMNS: TableColumn<AnalyticsWeek>[] = [
  { header: 'Week of', cell: (week) => weekLabel(week.week) },
  { header: 'Raised', cell: (week) => week.actionItemsCreated, numeric: true },
  { header: 'Done', cell: (week) => week.actionItemsCompleted, numeric: true },
  {
    header: 'Not done yet',
    cell: (week) => week.actionItemsCreated - week.actionItemsCompleted,
    numeric: true,
  },
];

const OUTCOME_COLUMNS: TableColumn<{ label: string; value: number; share: number }>[] = [
  { header: 'Outcome', cell: (row) => row.label },
  { header: 'Action items', cell: (row) => row.value, numeric: true },
  { header: 'Share', cell: (row) => percent(row.share), numeric: true },
];

const COMPLETION_COLUMNS: TableColumn<AnalyticsMember>[] = [
  { header: 'Member', cell: (member) => memberName(member) },
  { header: 'Tasks', cell: (member) => member.tasksAssigned, numeric: true },
  { header: 'Done', cell: (member) => member.tasksCompleted, numeric: true },
  { header: 'Completion', cell: (member) => percent(member.completionRate), numeric: true },
];

const ACTIVITY_COLUMNS: TableColumn<AnalyticsMember>[] = [
  { header: 'Member', cell: (member) => memberName(member) },
  { header: 'Meetings attended', cell: (member) => member.meetingsAttended, numeric: true },
  { header: 'Hosted', cell: (member) => member.meetingsHosted, numeric: true },
  {
    header: 'Time in meetings',
    cell: (member) => duration(member.minutesInMeetings),
    numeric: true,
  },
  { header: 'Action items owned', cell: (member) => member.actionItemsOwned, numeric: true },
  { header: 'Tasks completed', cell: (member) => member.tasksCompleted, numeric: true },
  { header: 'Chat messages', cell: (member) => member.messagesSent, numeric: true },
];

function memberName(member: AnalyticsMember): string {
  return member.isMember || member.name === 'Former member'
    ? member.name
    : `${member.name} (left the team)`;
}
