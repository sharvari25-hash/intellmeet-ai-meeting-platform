import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ANALYTICS_DEFAULT_WEEKS,
  ANALYTICS_MAX_RANGE_DAYS,
  ANALYTICS_PRESET_WEEKS,
  daysInclusive,
  isKnownTimeZone,
  rangeForWeeks,
  todayIn,
  type Team,
} from '@intellmeet/shared';
import type { AnalyticsParams } from './analytics.api';

/** The browser's time zone, which the weeks and "today" are counted in. */
export function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isKnownTimeZone(zone) ? zone : 'UTC';
}

const isIsoDate = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/**
 * Where the dashboard opens for someone in several teams: the one they have
 * been in longest, which for a demo guest is the seeded team rather than
 * the empty one they made a minute ago.
 */
function defaultTeam(teams: Team[]): Team | undefined {
  return [...teams].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

function rangeError(from: string, to: string): string | null {
  if (from > to) return 'The start date is after the end date.';
  if (daysInclusive(from, to) > ANALYTICS_MAX_RANGE_DAYS) {
    return `Choose at most ${ANALYTICS_MAX_RANGE_DAYS} days.`;
  }
  return null;
}

export interface AnalyticsFilters {
  team: Team | undefined;
  tz: string;
  today: string;
  from: string;
  to: string;
  /** The preset in use (4, 8 or 12 weeks), or null for a custom range. */
  preset: number | null;
  /** Why the custom range cannot be shown, if it cannot. */
  error: string | null;
  /** What to ask the API for; null until a team is known and the range is valid. */
  params: AnalyticsParams | null;
  setTeam: (teamId: string) => void;
  setPreset: (weeks: number) => void;
  setRange: (range: { from: string; to: string }) => void;
}

/**
 * The dashboard's filters, kept in the URL (`?team=&weeks=` or
 * `?team=&from=&to=`) so a view can be reloaded, shared, or gone back to.
 * A preset is relative ("the last 8 weeks" is a different range tomorrow);
 * a custom range is fixed.
 */
export function useAnalyticsFilters(teams: Team[] | undefined): AnalyticsFilters {
  const [search, setSearch] = useSearchParams();
  const tz = useMemo(browserTimeZone, []);
  const today = todayIn(tz);

  const requested = teams?.find((team) => team.id === search.get('team'));
  const team = requested ?? (teams ? defaultTeam(teams) : undefined);

  const from = search.get('from');
  const to = search.get('to');
  const custom = isIsoDate(from) && isIsoDate(to);
  const weeks = Number(search.get('weeks'));
  const preset = custom
    ? null
    : (ANALYTICS_PRESET_WEEKS as readonly number[]).includes(weeks)
      ? weeks
      : ANALYTICS_DEFAULT_WEEKS;
  const range = custom ? { from, to } : rangeForWeeks(preset ?? ANALYTICS_DEFAULT_WEEKS, today);
  const error = custom ? rangeError(range.from, range.to) : null;

  function update(changes: Record<string, string | null>) {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );
  }

  return {
    team,
    tz,
    today,
    from: range.from,
    to: range.to,
    preset,
    error,
    params: team && !error ? { teamId: team.id, from: range.from, to: range.to, tz } : null,
    setTeam: (teamId) => update({ team: teamId }),
    setPreset: (value) =>
      update({
        weeks: value === ANALYTICS_DEFAULT_WEEKS ? null : String(value),
        from: null,
        to: null,
      }),
    setRange: (next) => update({ from: next.from, to: next.to, weeks: null }),
  };
}
