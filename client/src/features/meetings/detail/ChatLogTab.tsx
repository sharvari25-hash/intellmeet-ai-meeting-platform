import { useInfiniteQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTime } from '../format';
import { getMessageHistory, messageKeys } from '../meetings.api';

/**
 * What was typed in the meeting's chat, oldest first.
 *
 * Paged backwards with the same cursor the room uses: the newest fifty load
 * first, and "Load earlier messages" walks towards the start of the meeting.
 */
export function ChatLogTab({ meetingId }: { meetingId: string }) {
  const log = useInfiniteQuery({
    queryKey: messageKeys.log(meetingId),
    queryFn: ({ pageParam }) => getMessageHistory(meetingId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  // Pages arrive newest first; each page is already oldest-first inside.
  const messages = log.data ? [...log.data.pages].reverse().flatMap((page) => page.messages) : [];

  return (
    <section aria-labelledby="chat-heading" className="rounded-xl border bg-card p-5">
      <h2 id="chat-heading" className="flex items-center gap-2 font-semibold">
        <MessageSquareText aria-hidden="true" className="size-4 text-primary" />
        Chat
      </h2>

      {log.isPending && (
        <div aria-live="polite" className="mt-3 space-y-2">
          <span className="sr-only">Loading the chat</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      )}

      {log.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Could not load the chat for this meeting.
        </p>
      )}

      {log.isSuccess && messages.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">Nobody used the chat in this meeting.</p>
      )}

      {log.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage && <Spinner label="Loading earlier messages" />}
          Load earlier messages
        </Button>
      )}

      {messages.length > 0 && (
        <ol className="mt-3 space-y-3 text-sm">
          {messages.map((message) => (
            <li key={message.id}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{message.senderName}</span>
                <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                  {formatTime(message.createdAt)}
                </time>
              </p>
              {/* Rendered as text, never as HTML: chat is other people's input. */}
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
