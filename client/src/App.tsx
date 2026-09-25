import { Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { LandingPage } from '@/features/landing/LandingPage';
import { useSessionBootstrap } from '@/hooks/useSession';
import { pages } from '@/routes/pages';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { PublicOnlyRoute } from '@/routes/PublicOnlyRoute';

const {
  AppShell,
  AnalyticsPage,
  DashboardPage,
  JoinTeamPage,
  LoginPage,
  MeetingDetailPage,
  MeetingsPage,
  NotFoundPage,
  RegisterPage,
  RoomPage,
  SettingsPage,
  TasksPage,
  TeamDetailPage,
  TeamsPage,
} = pages;

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
 * Every page but the landing page is a lazy chunk of its own (see
 * `routes/pages.ts`).
 */
export default function App() {
  useSessionBootstrap();

  return (
    // For the public pages. The signed-in shell has a boundary of its own
    // below, so moving between app pages never blanks the navigation.
    <Suspense fallback={<FullPageSpinner label="Loading" />}>
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
    </Suspense>
  );
}
