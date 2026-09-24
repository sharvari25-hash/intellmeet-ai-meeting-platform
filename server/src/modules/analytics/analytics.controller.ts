import type { RequestHandler } from 'express';
import type { AnalyticsExportQuery, AnalyticsQuery } from '@intellmeet/shared';
import { currentUser } from '../../middleware/requireAuth.js';
import { exportFileName, membersCsv, weeklyCsv } from './analytics.csv.js';
import { resolveScope } from './analytics.scope.js';
import { getMembers, getOverview, getWeekly } from './analytics.service.js';

/*
 * Every handler starts with `resolveScope`, which checks the caller is a
 * member of the team before anything is read, cached or not. The query has
 * already been validated (and its defaults applied) by `validate`.
 */

export const overview: RequestHandler = async (req, res) => {
  const scope = await resolveScope(req.query as unknown as AnalyticsQuery, currentUser(req).id);
  res.json(await getOverview(scope));
};

export const weekly: RequestHandler = async (req, res) => {
  const scope = await resolveScope(req.query as unknown as AnalyticsQuery, currentUser(req).id);
  res.json(await getWeekly(scope));
};

export const members: RequestHandler = async (req, res) => {
  const scope = await resolveScope(req.query as unknown as AnalyticsQuery, currentUser(req).id);
  res.json(await getMembers(scope));
};

/** `GET /api/analytics/export?dataset=weekly|members`: a CSV file. */
export const exportCsv: RequestHandler = async (req, res) => {
  const query = req.query as unknown as AnalyticsExportQuery;
  const scope = await resolveScope(query, currentUser(req).id);

  const csv =
    query.dataset === 'weekly'
      ? weeklyCsv(await getWeekly(scope))
      : membersCsv(await getMembers(scope));

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${exportFileName(scope, query.dataset)}"`,
    // Team data: never kept by a shared proxy or the browser's cache.
    'Cache-Control': 'private, no-store',
  });
  res.send(csv);
};
