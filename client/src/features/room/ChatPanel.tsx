import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SendHorizonal } from 'lucide-react';
import type { ChatMessage, Mentionable } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MentionSuggestions, MentionText } from '@/features/mentions/Mentions';
import { useMentionAutocomplete } from '@/features/mentions/useMentionAutocomplete';

interface Props {
  messages: ChatMessage[];
  typingNames: string[];
  selfUserId: string | undefined;
  onSend: (text: string) => void;
  onTyping: () => void;
  /** Team-mates who can be @mentioned (they are notified, in the room or not). */
  people?: readonly Mentionable[];
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const NOBODY: readonly Mentionable[] = [];

export function ChatPanel({
  messages,
  typingNames,
  selfUserId,
  onSend,
  onTyping,
  people = NOBODY,
}: Props) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentions = useMentionAutocomplete({
    value: draft,
    onValueChange: setDraft,
    people,
    inputRef,
  });

  // Stick to the bottom as messages arrive. `block: 'nearest'` keeps the
  // scroll inside this panel instead of dragging the whole page.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, typingNames.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* A log role means a screen reader announces new messages as they
          arrive without the user having to go looking for them. */}
      <div
        role="log"
        aria-label="Meeting chat"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello, or type @ to mention a team-mate.
          </p>
        )}

        {messages.map((message) => {
          const mine = message.senderId === selfUserId;

          return (
            <div key={message.id} className="text-sm">
              <p className="flex items-baseline gap-2">
                <span className="truncate font-medium">{mine ? 'You' : message.senderName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {time(message.createdAt)}
                </span>
              </p>
              {/* `break-words` matters: a pasted URL would otherwise widen the
                  panel and push the video grid off screen. */}
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                <MentionText text={message.text} people={people} />
              </p>
            </div>
          );
        })}

        <div ref={endRef} />
      </div>

      <p aria-live="polite" className="h-5 px-3 text-xs text-muted-foreground">
        {typingNames.length === 1 && `${typingNames[0]} is typing…`}
        {typingNames.length === 2 && `${typingNames[0]} and ${typingNames[1]} are typing…`}
        {typingNames.length > 2 && 'Several people are typing…'}
      </p>

      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <Label htmlFor="chat-input" className="sr-only">
          Message
        </Label>
        <div className="relative min-w-0 flex-1">
          <Input
            id="chat-input"
            ref={inputRef}
            value={draft}
            placeholder="Message the room"
            autoComplete="off"
            maxLength={2000}
            {...mentions.fieldProps}
            onKeyDown={(event) => {
              // Enter picks a suggestion when the list is open, and only
              // sends the message when it is not.
              mentions.handleKeyDown(event);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              mentions.handleChange(event);
              onTyping();
            }}
          />
          <MentionSuggestions
            id={mentions.listboxId}
            suggestions={mentions.suggestions}
            active={mentions.active}
            onChoose={mentions.choose}
          />
        </div>
        <Button type="submit" size="icon" aria-label="Send message" disabled={!draft.trim()}>
          <SendHorizonal aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
