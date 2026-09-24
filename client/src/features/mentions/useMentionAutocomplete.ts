import {
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import type { Mentionable } from '@intellmeet/shared';

/** The word being typed after an `@`, at the caret. */
const TRIGGER = /(?:^|\s)@([\p{L}\p{N}_]*)$/u;
const MAX_SUGGESTIONS = 6;

type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * "@" autocomplete for a text field: typing `@gr` offers Grace Hopper, and
 * choosing her writes `@Grace Hopper ` - the plain-text form the server
 * recognises (see `findMentions`), so what is typed is what gets notified.
 *
 * Works on an `<input>` (the room's chat) or a `<textarea>` (task comments).
 * The field keeps focus throughout; arrow keys move through the suggestions,
 * Enter or Tab chooses, Escape dismisses. The field points at the list with
 * `aria-controls` and at the highlighted person with `aria-activedescendant`,
 * so a screen reader announces each suggestion as it is highlighted.
 */
export function useMentionAutocomplete({
  value,
  onValueChange,
  people,
  inputRef,
}: {
  value: string;
  onValueChange: (value: string) => void;
  people: readonly Mentionable[];
  inputRef: RefObject<Field | null>;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    if (!query) return [];
    const typed = query.text.toLowerCase();
    return people
      .filter((person) =>
        person.name
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(typed)),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [query, people]);

  /** Re-reads the text before the caret: is an `@name` being typed? */
  function detect(text: string, caret: number | null) {
    const match = TRIGGER.exec(text.slice(0, caret ?? text.length));
    const typed = match?.[1];
    setQuery(
      match && typed !== undefined
        ? { start: (caret ?? text.length) - typed.length - 1, text: typed }
        : null,
    );
    setActive(0);
  }

  function choose(person: Mentionable) {
    if (!query) return;
    const end = query.start + 1 + query.text.length;
    const inserted = `@${person.name} `;
    onValueChange(`${value.slice(0, query.start)}${inserted}${value.slice(end)}`);
    setQuery(null);

    // Put the caret after the name, once the new value has rendered.
    const caret = query.start + inserted.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  /** Returns true when the key was for the suggestions, and must not do anything else. */
  function handleKeyDown(event: KeyboardEvent<Field>): boolean {
    if (suggestions.length === 0) return false;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => (index + 1) % suggestions.length);
        return true;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
        return true;
      case 'Enter':
      case 'Tab': {
        const person = suggestions[active];
        if (!person) return false;
        event.preventDefault();
        choose(person);
        return true;
      }
      case 'Escape':
        event.preventDefault();
        setQuery(null);
        return true;
      default:
        return false;
    }
  }

  const open = suggestions.length > 0;

  return {
    listboxId,
    suggestions,
    active,
    choose,
    handleKeyDown,
    /** Call from the field's onChange, after updating the value. */
    handleChange: (event: ChangeEvent<Field>) =>
      detect(event.target.value, event.target.selectionStart),
    /** Spread onto the field. */
    fieldProps: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? listboxId : undefined,
      'aria-activedescendant': open ? `${listboxId}-${active}` : undefined,
      // The caret moved (a click, the arrow keys): the `@` it is after may differ.
      onSelect: (event: SyntheticEvent<Field>) =>
        detect(event.currentTarget.value, event.currentTarget.selectionStart),
      onBlur: () => setQuery(null),
    },
  };
}
