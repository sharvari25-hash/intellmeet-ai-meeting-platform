import { lazy } from 'react';

/**
 * Every page but the landing page, loaded on demand.
 *
 * The landing page is the first thing most visitors - and every reviewer -
 * download, and nothing here is needed to render it: the signed-in half (the
 * dashboard, the room, the board, the charts) was split from the start, and
 * Phase 10's bundle analysis moved the public forms out too (react-hook-form
 * alone was 6.5% of the entry chunk).
 *
 * Each `lazy` maps a named export onto a default, because this codebase
 * exports components by name and `lazy` requires a default export.
 */
export const pages = {
  AppShell: lazy(() =>
    import('@/layouts/AppShell').then((module) => ({ default: module.AppShell })),
  ),
  LoginPage: lazy(() =>
    import('@/features/auth/LoginPage').then((module) => ({ default: module.LoginPage })),
  ),
  RegisterPage: lazy(() =>
    import('@/features/auth/RegisterPage').then((module) => ({ default: module.RegisterPage })),
  ),
  JoinTeamPage: lazy(() =>
    import('@/features/teams/JoinTeamPage').then((module) => ({ default: module.JoinTeamPage })),
  ),
  NotFoundPage: lazy(() =>
    import('@/features/errors/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
  ),
  DashboardPage: lazy(() =>
    import('@/features/dashboard/DashboardPage').then((module) => ({
      default: module.DashboardPage,
    })),
  ),
  TeamsPage: lazy(() =>
    import('@/features/teams/TeamsPage').then((module) => ({ default: module.TeamsPage })),
  ),
  TeamDetailPage: lazy(() =>
    import('@/features/teams/TeamDetailPage').then((module) => ({
      default: module.TeamDetailPage,
    })),
  ),
  SettingsPage: lazy(() =>
    import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
  ),
  MeetingsPage: lazy(() =>
    import('@/features/meetings/MeetingsPage').then((module) => ({ default: module.MeetingsPage })),
  ),
  MeetingDetailPage: lazy(() =>
    import('@/features/meetings/MeetingDetailPage').then((module) => ({
      default: module.MeetingDetailPage,
    })),
  ),
  // The room carries the WebRTC stack, the board dnd-kit, and analytics
  // Recharts (the biggest dependency after the PDF engine): nobody downloads
  // any of them to read the dashboard.
  RoomPage: lazy(() =>
    import('@/features/room/RoomPage').then((module) => ({ default: module.RoomPage })),
  ),
  TasksPage: lazy(() =>
    import('@/features/tasks/TasksPage').then((module) => ({ default: module.TasksPage })),
  ),
  AnalyticsPage: lazy(() =>
    import('@/features/analytics/AnalyticsPage').then((module) => ({
      default: module.AnalyticsPage,
    })),
  ),
};
