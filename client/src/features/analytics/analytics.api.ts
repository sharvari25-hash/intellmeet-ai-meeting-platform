import {
  analyticsMembersSchema,
  analyticsOverviewSchema,
  analyticsWeeklySchema,
  type AnalyticsDataset,
  type AnalyticsMembers,
  type AnalyticsOverview,
  type AnalyticsWeekly,
} from '@intellmeet/shared';
import { api, apiFetch } from '@/lib/apiClient';
import { saveBlob } from '@/lib/download';

/** One team, a range of days, and the time zone they are days in. */
export interface AnalyticsParams {
  teamId: string;
  from: string;
  to: string;
  tz: string;
}

export const analyticsKeys = {
  all: ['analytics'] as const,
  part: (kind: 'overview' | 'weekly' | 'members', params: AnalyticsParams) =>
    ['analytics', kind, params] as const,
};

function query(params: AnalyticsParams, extra: Record<string, string> = {}): string {
  return new URLSearchParams({ ...params, ...extra }).toString();
}

export function getOverview(params: AnalyticsParams): Promise<AnalyticsOverview> {
  return api(`/analytics/overview?${query(params)}`, analyticsOverviewSchema);
}

export function getWeekly(params: AnalyticsParams): Promise<AnalyticsWeekly> {
  return api(`/analytics/weekly?${query(params)}`, analyticsWeeklySchema);
}

export function getMembers(params: AnalyticsParams): Promise<AnalyticsMembers> {
  return api(`/analytics/members?${query(params)}`, analyticsMembersSchema);
}

/** The file name from `Content-Disposition: attachment; filename="..."`. */
export function fileNameFromDisposition(header: string | null): string | null {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? null;
}

/**
 * Downloads one of the CSV exports, for exactly the team and range on
 * screen. Built by the server, which escapes anything a spreadsheet would
 * run as a formula; fetched with the bearer token (a plain link could not
 * carry it) and handed to the browser as a file.
 */
export async function downloadAnalyticsCsv(
  params: AnalyticsParams,
  dataset: AnalyticsDataset,
): Promise<string> {
  const response = await apiFetch(`/analytics/export?${query(params, { dataset })}`);
  if (!response.ok) throw new Error(`The export failed (HTTP ${response.status}).`);

  const name =
    fileNameFromDisposition(response.headers.get('content-disposition')) ??
    `intellmeet-${dataset}-${params.from}-to-${params.to}.csv`;
  saveBlob(await response.blob(), name);
  return name;
}
