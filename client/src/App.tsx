import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ComingSoon } from '@/components/ComingSoon';
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
 * Routes whose feature lands in a later phase are wired now with an honest
 * placeholder: the navigation, the guards and the layout are then exercised
 * end to end from this phase onward, instead of being bolted together later.
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

          <Route
            path="meetings"
            element={
              <ComingSoon title="Meeting history" phase="Phase 7">
                Transcripts, summaries and decisions from every past meeting, searchable.
              </ComingSoon>
            }
          />
          <Route
            path="room/:roomCode"
            element={
              <ComingSoon title="Meeting room" phase="Phase 5">
                Video, screen share, chat and the participant list. The signalling backend is
                already live.
              </ComingSoon>
            }
          />
          <Route
            path="tasks"
            element={
              <ComingSoon title="Task board" phase="Phase 8">
                Action items from your meetings, on a Kanban board that syncs in real time.
              </ComingSoon>
            }
          />
          <Route
            path="analytics"
            element={
              <ComingSoon title="Analytics" phase="Phase 9">
                Meeting time, participation and follow-through across the team.
              </ComingSoon>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
