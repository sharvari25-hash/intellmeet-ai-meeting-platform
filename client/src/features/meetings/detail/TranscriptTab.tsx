import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { ScrollText, Search } from 'lucide-react';
import type { Meeting, Transcript } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatOffset } from '../aiStatus';
import { Highlight } from '../Highlight';
import { matchesQuery } from '../textMatch';
import type { RecordingSource } from './useRecordingSource';

/**
 * The timestamped transcript: searchable, and with a recording, every
 * timestamp is a button that plays the meeting from that moment.
 *
 * `initialQuery` and `initialTime` come from the URL, so a history search
 * result can land here with its words highlighted and its line in view.
 */
export function TranscriptTab({
  meeting,
  transcript,
  source,
  initialQuery,
  initialTime,
}: {
  meeting: Meeting;
  transcript: Transcript;
  source: RecordingSource;
  initialQuery: string;
  initialTime: number | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const audio = useRef<HTMLAudioElement>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const segments = transcript.segments;

  const visible = useMemo(
    () =>
      segments
        .map((segment, index) => ({ segment, index }))
        .filter(({ segment }) => !query.trim() || matchesQuery(segment.text, query)),
    [segments, query],
  );

  // The line a deep link points at, or the one playing now.
  const target = initialTime === null ? -1 : lastStartingBefore(segments, initialTime);
  const playing = playhead === null ? -1 : lastStartingBefore(segments, playhead);
  const targetRef = useRef<HTMLLIElement>(null);

  // Once, on arrival: re-scrolling while someone reads would be hostile.
  useEffect(() => {
    targetRef.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  const canPlay = source.status === 'ready';

  function playFrom(seconds: number) {
    const element = audio.current;
    if (!element) return;
    element.currentTime = seconds;
    void element.play().catch(() => {
      // Autoplay policy or a decode error: the position is still set, and the
      // player's own button works.
    });
  }

  return (
    <section aria-labelledby="transcript-heading" className="rounded-xl border bg-card p-5">
      <h2 id="transcript-heading" className="flex items-center gap-2 font-semibold">
        <ScrollText aria-hidden="true" className="size-4 text-primary" />
        Transcript
      </h2>

      <RecordingPlayer
        source={source}
        audioRef={audio}
        startAt={initialTime}
        onTime={setPlayhead}
        className="mt-3"
      />
      {!meeting.recording && (
        <p className="mt-2 text-xs text-muted-foreground">
          There is no recording of this meeting, so the timestamps are for reference.
        </p>
      )}

      <div className="relative mt-4">
        <Label htmlFor="transcript-search" className="sr-only">
          Search the transcript
        </Label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id="transcript-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the transcript"
          className="pl-8"
        />
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {query.trim()
          ? `${visible.length} of ${segments.length} lines match`
          : `${segments.length} lines`}
      </p>

      <ol
        className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto rounded-md pr-2 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        // A list that scrolls must be reachable by keyboard. With a recording
        // its "Play from" buttons are the way in; without one nothing inside
        // it takes focus, so the list itself does (axe:
        // scrollable-region-focusable, Phase 10).
        {...(canPlay ? {} : { tabIndex: 0, 'aria-label': 'Transcript lines' })}
      >
        {visible.map(({ segment, index }) => (
          <li
            key={`${index}-${segment.start}`}
            ref={index === target ? targetRef : undefined}
            aria-current={index === playing ? 'true' : undefined}
            className={cn(
              'flex gap-3 rounded-md px-2 py-1',
              index === target && playing === -1 && 'bg-primary/10',
              index === playing && 'bg-primary/10',
            )}
          >
            {canPlay ? (
              <button
                type="button"
                onClick={() => playFrom(segment.start)}
                aria-label={`Play from ${formatOffset(segment.start)}`}
                className="h-5 w-12 shrink-0 rounded font-mono text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {formatOffset(segment.start)}
              </button>
            ) : (
              <span className="w-12 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                {formatOffset(segment.start)}
              </span>
            )}
            <p className="min-w-0">
              {segment.speaker && <span className="font-medium">{segment.speaker}: </span>}
              <Highlight text={segment.text} query={query} />
            </p>
          </li>
        ))}
      </ol>

      {visible.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Nothing in the transcript matches.</p>
      )}
    </section>
  );
}

/** The index of the last segment that starts at or before `seconds`. */
function lastStartingBefore(segments: Transcript['segments'], seconds: number): number {
  let found = -1;
  segments.forEach((segment, index) => {
    if (segment.start <= seconds) found = index;
  });
  return found;
}

/** The meeting's audio, or why it cannot be played. Shared by two tabs. */
export function RecordingPlayer({
  source,
  audioRef,
  startAt = null,
  onTime,
  className,
}: {
  source: RecordingSource;
  audioRef?: Ref<HTMLAudioElement>;
  startAt?: number | null;
  onTime?: (seconds: number) => void;
  className?: string;
}) {
  if (source.status === 'none') return null;

  if (source.status === 'loading') {
    return (
      <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Spinner label="Loading the recording" />
        Loading the recording…
      </p>
    );
  }

  if (source.status === 'error') {
    return (
      <p role="alert" className={cn('text-sm text-destructive', className)}>
        {source.error.message}
      </p>
    );
  }

  return (
    <audio
      ref={audioRef}
      controls
      preload="metadata"
      src={source.src}
      aria-label="Meeting recording"
      className={cn('w-full', className)}
      onLoadedMetadata={(event) => {
        if (startAt !== null) event.currentTarget.currentTime = startAt;
      }}
      onTimeUpdate={(event) => onTime?.(event.currentTarget.currentTime)}
    />
  );
}
