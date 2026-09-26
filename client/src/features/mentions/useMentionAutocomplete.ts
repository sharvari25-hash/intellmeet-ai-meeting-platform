import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
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

  /**
   * Where the caret belongs after a name is chosen, until the field shows it.
   *
   * Writing a field's value puts its caret at the end, so after the choice
   * re-renders the field the caret has to be moved back to just after the
   * name. A layout effect runs in the same commit as that write, before the
   * browser handles another key or paints. The move used to wait for the next
   * animation frame, and a key pressed in between (a fast typist, or a queued
   * keystroke while a call's video keeps the main thread busy) was typed first
   * and then overtaken: "Thanks @Grace Hopper an you check?c".
   */
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const field = inputRef.current;
    if (caret === null || !field || field.value !== value) return;
    pendingCaret.current = null;
    field.focus();
    field.setSelectionRange(caret, caret);
  });

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
    // The caret goes after the name as part of the render that writes it
    // (the layout effect above), never later: a key pressed before a later
    // moment would land first and then be overtaken by the move.
    pendingCaret.current = query.start + inserted.length;
    onValueChange(`${value.slice(0, query.start)}${inserted}${value.slice(end)}`);
    setQuery(null);
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
