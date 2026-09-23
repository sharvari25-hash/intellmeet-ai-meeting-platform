import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { SOCKET_EVENTS } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import { listNotifications, markAllRead, markRead, notificationKeys } from './notifications.api';

/** "3 minutes ago" without pulling in a date library for one string. */
function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell() {
  const status = useAuthStore((state) => state.status);
  const socket = useSocketStore((state) => state.socket);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: notificationKeys.all,
    queryFn: listNotifications,
    enabled: status === 'authenticated',
  });

  // The socket is the live path; this query is what fills the bell on load and
  // what the push invalidates. Refetching on the event rather than splicing the
  // payload into the cache keeps one source of truth for the unread count,
  // which is computed server-side.
  // Depending on the socket itself - not on a module-level getter - is what
  // makes this correct regardless of mount order: the effect re-runs the
  // moment the shell above has connected.
  useEffect(() => {
    if (!socket) return;

    const onNew = () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    };

    socket.on(SOCKET_EVENTS.NOTIFY_NEW, onNew);
    return () => {
      socket.off(SOCKET_EVENTS.NOTIFY_NEW, onNew);
    };
  }, [queryClient, socket]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  const readOne = useMutation({ mutationFn: markRead, onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: markAllRead, onSuccess: invalidate });

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell aria-hidden="true" className="size-4" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px] leading-none"
            >
              {unread > 9 ? '9+' : unread}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {unread > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => readAll.mutate()}
            >
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        )}

        {notifications.slice(0, 8).map((notification) => (
          <DropdownMenuItem
            key={notification.id}
            className="flex-col items-start gap-0.5"
            onSelect={() => {
              if (!notification.readAt) readOne.mutate(notification.id);
            }}
          >
            <span className="flex w-full items-center gap-2">
              {!notification.readAt && (
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
              )}
              <span className="truncate font-medium">{notification.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {timeAgo(notification.createdAt)}
              </span>
            </span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{notification.body}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
