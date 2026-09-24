import { useEffect, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, History, Search, SearchX } from 'lucide-react';
import type { MeetingStatus } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { Skeleton } from '@/components/ui/skeleton';
import { listTeams, teamKeys } from '@/features/teams/teams.api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/utils';
import { CreateMeetingDialog } from './CreateMeetingDialog';
import { HistoryRow } from './HistoryRow';
import { listMeetings, meetingKeys } from './meetings.api';
import { useAiStatusUpdates } from './useAiStatusUpdates';

export const HISTORY_PAGE_SIZE = 10;

/** The filter buttons, in reading order, and the status each asks the API for. */
const FILTERS = [
  { value: 'all', label: 'All', status: undefined },
  { value: 'upcoming', label: 'Upcoming', status: 'scheduled' },
  { value: 'live', label: 'Live', status: 'live' },
  { value: 'past', label: 'Past', status: 'ended' },
] as const satisfies readonly { value: string; label: string; status?: MeetingStatus }[];

type Filter = (typeof FILTERS)[number]['value'];

function toFilter(value: string | null): Filter {
  return FILTERS.find((filter) => filter.value === value)?.value ?? 'all';
}

/**
 * Meeting history: every meeting in the caller's teams, filterable by status
 * and searchable by what was said, not only by title.
 *
 * All of the state - query, filter, team, page - lives in the URL, so a
 * search can be shared as a link, survives a reload, and Back returns to the
 * results rather than to an empty box. The request waits for typing to pause.
 */
export function MeetingsPage() {
  const [params, setParams] = useSearchParams();
  const filter = toFilter(params.get('status'));
  const status = FILTERS.find((entry) => entry.value === filter)?.status;
  const teamId = params.get('team') ?? undefined;
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const q = params.get('q') ?? '';

  const [draft, setDraft] = useState(q);
  const settled = useDebouncedValue(draft.trim(), 300);

  // Typing becomes a search once it pauses; a new search starts at page 1.
  useEffect(() => {
    if (settled === q) return;
    update({ q: settled || null, page: null });
    // Only a change in what was typed should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  // ...and Back or a pasted link puts the URL's query back in the box.
  useEffect(() => {
    setDraft((current) => (current.trim() === q ? current : q));
  }, [q]);

  function update(changes: Record<string, string | null>) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });

  const request = { teamId, status, q, page };
  const list = useQuery({
    queryKey: meetingKeys.history(request),
    queryFn: () => listMeetings({ ...request, limit: HISTORY_PAGE_SIZE }),
    // Keeps the current rows on screen while the next page or a refined
    // search loads, instead of flashing back to skeletons on every keystroke.
    placeholderData: keepPreviousData,
  });

  // A summary finishing elsewhere turns its row's badge to "Summary ready".
  useAiStatusUpdates();

  const pageCount = list.data ? Math.max(1, Math.ceil(list.data.total / HISTORY_PAGE_SIZE)) : 1;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Enter searches straight away rather than waiting for the debounce.
    update({ q: draft.trim() || null, page: null });
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <History aria-hidden="true" className="size-6 text-primary" />
            Meetings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every meeting in your teams. Search finds words in titles, summaries and transcripts.
          </p>
        </div>
        <CreateMeetingDialog defaultTeamId={teamId} />
      </header>

      <div className="space-y-3">
        <form role="search" onSubmit={onSubmit} className="relative">
          <Label htmlFor="history-search" className="sr-only">
            Search meetings
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="history-search"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search titles, summaries and transcripts"
            className="pl-8"
            maxLength={140}
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Show meetings"
            className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1"
          >
            {FILTERS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                aria-pressed={filter === entry.value}
                onClick={() =>
                  update({ status: entry.value === 'all' ? null : entry.value, page: null })
                }
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors',
                  'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  filter === entry.value && 'bg-background text-foreground shadow-sm',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {/* Only worth a control for someone in more than one team. */}
          {teams.data && teams.data.length > 1 && (
            <div className="w-full sm:w-56">
              <Label htmlFor="history-team" className="sr-only">
                Team
              </Label>
              <NativeSelect
                id="history-team"
                value={teamId ?? ''}
                onChange={(event) => update({ team: event.target.value || null, page: null })}
              >
                <option value="">All teams</option>
                {teams.data.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="history-results" aria-busy={list.isFetching}>
        <h2 id="history-results" className="sr-only">
          Results
        </h2>

        {list.isPending && (
          <div aria-live="polite" className="space-y-3">
            <span className="sr-only">Loading meetings</span>
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-28 w-full" />
            ))}
          </div>
        )}

        {list.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load your meetings.{' '}
            <button type="button" className="underline" onClick={() => void list.refetch()}>
              Try again
            </button>
          </p>
        )}

        {list.data && (
          <>
            <p
              aria-live="polite"
              className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
            >
              {resultSummary(list.data.total, q, filter)}
              {list.isPlaceholderData && <Spinner label="Updating" />}
            </p>

            {list.data.meetings.length === 0 ? (
              <EmptyHistory q={q} filter={filter} onClear={() => update({ q: null, page: null })} />
            ) : (
              <ul className="space-y-3">
                {list.data.meetings.map((meeting) => (
                  <HistoryRow key={meeting.id} meeting={meeting} query={q} />
                ))}
              </ul>
            )}

            {pageCount > 1 && (
              <nav
                aria-label="Pagination"
                className="mt-5 flex items-center justify-between gap-2 text-sm"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : null })}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <span className="text-muted-foreground">
                  Page {Math.min(page, pageCount)} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => update({ page: String(page + 1) })}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function resultSummary(total: number, q: string, filter: Filter): string {
  const noun = total === 1 ? 'meeting' : 'meetings';
  if (q) return `${total} ${noun} matching “${q}”`;
  if (filter === 'all') return `${total} ${noun}`;
  return `${total} ${FILTERS.find((entry) => entry.value === filter)?.label.toLowerCase()} ${noun}`;
}

function EmptyHistory({ q, filter, onClear }: { q: string; filter: Filter; onClear: () => void }) {
  if (q) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <SearchX aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 font-medium">Nothing matches “{q}”</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try another word, or a word someone would have said in the meeting.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          Clear the search
        </Button>
      </div>
    );
  }

  const text: Record<Filter, string> = {
    all: 'No meetings yet. Start one and it appears here, with its summary once it is recorded.',
    upcoming: 'Nothing scheduled. Schedule a meeting and it appears here.',
    live: 'Nobody is in a meeting right now.',
    past: 'No meetings have ended yet.',
  };

  return (
    <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text[filter]}
    </p>
  );
}
