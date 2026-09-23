import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { clearPendingInvite, rememberInvite } from './pendingInvite';
import { joinTeam, teamKeys } from './teams.api';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 text-center text-card-foreground shadow-sm">
        <Users aria-hidden="true" className="mx-auto size-8 text-primary" />
        {children}
      </div>
    </main>
  );
}

/**
 * Redeems an invite link.
 *
 * The route is public because the link lands in someone's inbox before they
 * have an account - but joining a team is not, so an anonymous visitor is
 * shown the invite and sent to sign in with this page recorded as their
 * destination. They come straight back here afterwards and the code redeems
 * itself.
 */
export function JoinTeamPage() {
  const { code = '' } = useParams();
  const status = useAuthStore((state) => state.status);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const join = useMutation({
    mutationFn: () => joinTeam(code),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.all });
      toast.success(`You joined ${team.name}`);
      navigate(`/app/teams/${team.id}`, { replace: true });
    },
  });

  // Redeem once, automatically, as soon as there is a session. The ref guard
  // is what stops StrictMode's double-invoked effect sending the code twice.
  const attempted = useRef(false);
  const { mutate } = join;

  useEffect(() => {
    if (!code) return;

    // Park the code before sending them off to sign up. Router state carries
    // it back for anyone who uses the buttons below, but not for someone who
    // reaches the form another way, and the promise on this page - "you will
    // join it automatically" - has to hold either way.
    if (status === 'anonymous') {
      rememberInvite(code);
      return;
    }

    if (status !== 'authenticated' || attempted.current) return;

    attempted.current = true;
    // Cleared on the attempt, not on success: a code that cannot be redeemed
    // must not follow the user into every future sign-in on this tab.
    clearPendingInvite();
    mutate();
  }, [status, code, mutate]);

  if (status === 'bootstrapping') {
    return (
      <Frame>
        <Spinner label="Checking your session" />
      </Frame>
    );
  }

  if (status === 'anonymous') {
    return (
      <Frame>
        <h1 className="text-lg font-semibold tracking-tight">You have been invited to a team</h1>
        <p className="text-sm text-muted-foreground">
          Sign in or create an account and you will join it automatically.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to="/login" state={{ from: location }}>
              Sign in
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/register" state={{ from: location }}>
              Create an account
            </Link>
          </Button>
        </div>
      </Frame>
    );
  }

  if (join.isError) {
    return (
      <Frame>
        <h1 className="text-lg font-semibold tracking-tight">That invite did not work</h1>
        <p className="text-sm text-muted-foreground">
          {join.error instanceof ApiError
            ? join.error.message
            : 'The code may have expired or already been used.'}
        </p>
        <Button asChild variant="outline">
          <Link to="/app/teams">Go to your teams</Link>
        </Button>
      </Frame>
    );
  }

  return (
    <Frame>
      <p className="text-sm text-muted-foreground">Joining the team…</p>
      <Spinner label="Joining the team" />
    </Frame>
  );
}
