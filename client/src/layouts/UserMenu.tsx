import { useState } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FormError } from '@/features/auth/FormError';
import { useEndDemoSession, useLogout } from '@/features/auth/useAuth';
import { useAuthStore } from '@/stores/authStore';

/**
 * The account menu in the top bar.
 *
 * A demo guest gets one more item, **End demo session**, which deletes the
 * guest with what it created. Signing out alone would leave both behind until
 * the sweep: a guest has no password, so nobody could ever sign back in to
 * tidy up. It asks first, because a reviewer's recorded meetings go with it.
 */
export function UserMenu() {
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!user) return null;

  const isGuest = user.authProvider === 'guest';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Account menu for ${user.name}`}>
            <Avatar>
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{user.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {/* A guest's address is synthetic and meaningless to them. */}
              {isGuest ? 'Demo guest - rename yourself in Settings' : user.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
          {isGuest && (
            // The dialog is opened from `onSelect`, after the menu has closed,
            // so focus returns to the trigger rather than into a dead menu.
            <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
              <Trash2 aria-hidden="true" />
              End demo session
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {isGuest && (
        <EndDemoDialog open={confirmOpen} onOpenChange={setConfirmOpen} name={user.name} />
      )}
    </>
  );
}

function EndDemoDialog({
  open,
  onOpenChange,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
}) {
  const endSession = useEndDemoSession();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) endSession.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End the demo session?</DialogTitle>
          <DialogDescription>
            This signs you out and deletes your guest account, {name}, together with the meetings
            you hosted and any teams you created. The shared sample meetings are not affected.
          </DialogDescription>
        </DialogHeader>

        <FormError error={endSession.error} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep exploring
          </Button>
          <Button
            variant="destructive"
            disabled={endSession.isPending}
            onClick={() => endSession.mutate()}
          >
            {endSession.isPending && <Spinner label="Ending the demo session" />}
            End session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
