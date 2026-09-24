import { useMemo } from 'react';
import { findMentionSpans, type Mentionable } from '@intellmeet/shared';
import { cn } from '@/lib/utils';

/**
 * The people an `@` could mean, below or above the field.
 *
 * Chosen with `mousedown` rather than `click`, so the field never loses focus
 * (a blur would close the list before the click landed).
 */
export function MentionSuggestions({
  id,
  suggestions,
  active,
  onChoose,
  placement = 'above',
}: {
  id: string;
  suggestions: readonly Mentionable[];
  active: number;
  onChoose: (person: Mentionable) => void;
  placement?: 'above' | 'below';
}) {
  if (suggestions.length === 0) return null;

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="People to mention"
      className={cn(
        'absolute left-0 z-20 w-64 max-w-full rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1',
      )}
    >
      {suggestions.map((person, index) => (
        <li
          key={person.id}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(person);
          }}
          className={cn(
            'cursor-pointer truncate rounded px-2 py-1.5 text-sm',
            index === active && 'bg-accent text-accent-foreground',
          )}
        >
          {person.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Text with its mentions picked out, by the same rules the server used to
 * decide who to notify.
 */
export function MentionText({ text, people }: { text: string; people: readonly Mentionable[] }) {
  const parts = useMemo(() => {
    const spans = findMentionSpans(text, people);
    const pieces: { text: string; mention: boolean }[] = [];
    let at = 0;
    for (const span of spans) {
      if (span.start > at) pieces.push({ text: text.slice(at, span.start), mention: false });
      pieces.push({ text: text.slice(span.start, span.end), mention: true });
      at = span.end;
    }
    if (at < text.length) pieces.push({ text: text.slice(at), mention: false });
    return pieces;
  }, [text, people]);

  return (
    <>
      {parts.map((part, index) =>
        part.mention ? (
          <span key={index} className="font-medium text-primary">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
