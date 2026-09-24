import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { LandingPage } from '@/features/landing/LandingPage';
import { JoinTeamPage } from '@/features/teams/JoinTeamPage';
import { useSessionBootstrap } from '@/hooks/useSession';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';

/**
 * The signed-in half of the app is loaded on demand.
 *
 * The landing page is the first thing most visitors - and every reviewer -
 * download, and none of the dashboard, the team screens or the charting that
 * arrives in later phases is needed to render it. Splitting here keeps the
 * public bundle to the pages a signed-out visitor can actually reach.
 *
 * Each `lazy` call maps the named export onto a default, because this codebase
 * exports components by name and `lazy` requires a default export.
 */
const AppShell = lazy(() =>
  import('@/layouts/AppShell').then((module) => ({ default: module.AppShell })),
);
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
);
const TeamsPage = lazy(() =>
  import('@/features/teams/TeamsPage').then((module) => ({ default: module.TeamsPage })),
);
const TeamDetailPage = lazy(() =>
  import('@/features/teams/TeamDetailPage').then((module) => ({
    default: module.TeamDetailPage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const MeetingsPage = lazy(() =>
  import('@/features/meetings/MeetingsPage').then((module) => ({ default: module.MeetingsPage })),
);
const MeetingDetailPage = lazy(() =>
  import('@/features/meetings/MeetingDetailPage').then((module) => ({
    default: module.MeetingDetailPage,
  })),
);
// The board carries dnd-kit with it, so it is its own chunk too.
const TasksPage = lazy(() =>
  import('@/features/tasks/TasksPage').then((module) => ({ default: module.TasksPage })),
);
// Recharts is the biggest dependency after the PDF engine; only this page uses it.
const AnalyticsPage = lazy(() =>
  import('@/features/analytics/AnalyticsPage').then((module) => ({
    default: module.AnalyticsPage,
  })),
);
// The room carries the WebRTC stack with it, so it is its own chunk: nobody
// downloads a mesh transport to read the dashboard.
const RoomPage = lazy(() =>
  import('@/features/room/RoomPage').then((module) => ({ default: module.RoomPage })),
);

/**
 * The route tree.
 *
 * Three zones, each with its own guard:
 *
 * - **Public** (`/`, `/join/:code`) - reachable signed in or out.
 * - **Public-only** (`/login`, `/register`) - a signed-in user is bounced to
 *   the dashboard rather than offered a second sign-in.
 * - **Protected** (`/app/*`) - guarded, then wrapped in the app shell so every
 *   page inside it inherits the sidebar, the bell and the theme toggle
 *   without repeating them.
 *
 * Every page behind the navigation is a lazy chunk of its own (the ones that
 * arrived in later phases were placeholders until then, so the navigation,
 * the guards and the layout were exercised end to end from the start).
 */
export default function App() {
  useSessionBootstrap();

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/join/:code" element={<JoinTeamPage />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route path="/app" element={<ProtectedRoute />}>
        {/* One boundary for the shell itself. Page-level suspense lives inside
            AppShell, so navigating between pages keeps the nav on screen
            instead of replacing the whole viewport with a spinner. */}
        <Route
          element={
            <Suspense fallback={<FullPageSpinner label="Loading your workspace" />}>
              <AppShell />
            </Suspense>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="teams/:teamId" element={<TeamDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />

          <Route path="meetings" element={<MeetingsPage />} />
          <Route path="meetings/:meetingId" element={<MeetingDetailPage />} />
          <Route path="room/:roomCode" element={<RoomPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
