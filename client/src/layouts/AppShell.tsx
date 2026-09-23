import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useLogout } from '@/features/auth/useAuth';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useSocketLifecycle } from '@/hooks/useSocketLifecycle';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';

/**
 * One nav definition, rendered twice.
 *
 * The desktop rail and the mobile sheet are different elements but never
 * different *content* - deriving both from this array is what stops them
 * drifting as routes are added in later phases.
 */
const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/meetings', label: 'Meetings', icon: Video, end: false },
  { to: '/app/teams', label: 'Team', icon: Users, end: false },
  { to: '/app/tasks', label: 'Tasks', icon: KanbanSquare, end: false },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, end: false },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            {/* aria-current is what a screen reader uses to announce "current
                page"; the colour change alone would not. NavLink sets it. */}
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground"
      >
        IM
      </span>
      IntellMeet
    </span>
  );
}

function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Account menu for ${user.name}`}>
          <Avatar>
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The signed-in shell: a persistent rail from `md` up, a slide-in sheet below.
 *
 * The sheet is closed on every navigation, because a drawer left open over the
 * page the user just asked for is the most common mobile-nav bug.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  // The socket belongs to the signed-in app, so it is opened here rather than
  // at the root - which also keeps socket.io-client out of the public bundle.
  useSocketLifecycle();

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* Skip link: the first tabbable element on the page, so a keyboard user
          does not have to tab through the whole nav on every route. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="hidden border-r bg-card md:flex md:flex-col md:gap-6 md:p-4">
        <NavLink to="/app" className="px-1 py-1">
          <Wordmark />
        </NavLink>
        <nav aria-label="Main">
          <NavItems />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetTitle>
                <Wordmark />
              </SheetTitle>
              <nav aria-label="Main">
                <NavItems onNavigate={() => setMobileNavOpen(false)} />
              </nav>
            </SheetContent>
          </Sheet>

          <span className="md:hidden">
            <Wordmark />
          </span>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          {/* Each page is its own lazy chunk, so the boundary lives here
              rather than around the whole shell: a page transition swaps the
              content and leaves the nav, the bell and the header in place. */}
          <Suspense
            fallback={
              <div className="flex justify-center py-16">
                <Spinner label="Loading the page" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
