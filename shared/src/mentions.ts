/**
 * `@mentions` in chat messages and task comments.
 *
 * A mention is plain text - "@Ada Lovelace" or, when the first name is
 * unique, "@Ada" - matched against the people who can see the conversation.
 * No markup is stored, so a message reads the same in the room, the chat log,
 * an export or a notification, and nothing has to render a token.
 *
 * Shared, so the people the server notifies are exactly the names the page
 * highlights.
 */

export interface Mentionable {
  id: string;
  name: string;
}

export interface MentionSpan {
  /** Index of the `@`. */
  start: number;
  /** Index just past the name. */
  end: number;
  person: Mentionable;
}

/** Characters that continue a name, so "@Ada" is not found inside "@Adam". */
const NAME_CHAR = /[\p{L}\p{N}_]/u;
const WORD = /^[\p{L}\p{N}_]+/u;

function endsAt(rest: string, length: number): boolean {
  return !NAME_CHAR.test(rest.charAt(length));
}

/**
 * Every mention in `text`, in order.
 *
 * Full names win over first names, longest first, so "@Ada Lovelace" is one
 * mention of Ada rather than "@Ada" plus " Lovelace". A first name counts only
 * when nobody else in `people` shares it: "@Amber" with two Ambers mentions
 * nobody, rather than guessing - the same rule the AI's owner matching uses.
 * An `@` inside a word ("ada@example.com") is an address, not a mention.
 */
export function findMentionSpans(text: string, people: readonly Mentionable[]): MentionSpan[] {
  if (!text.includes('@') || people.length === 0) return [];

  const lower = text.toLowerCase();
  const byFullName = [...people].sort((a, b) => b.name.length - a.name.length);

  // First name -> person, or null once a second person has it.
  const byFirstName = new Map<string, Mentionable | null>();
  for (const person of people) {
    const first = person.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first) continue;
    byFirstName.set(first, byFirstName.has(first) ? null : person);
  }

  const spans: MentionSpan[] = [];
  let at = lower.indexOf('@');

  while (at !== -1) {
    const previous = text.charAt(at - 1);
    if (at > 0 && NAME_CHAR.test(previous)) {
      at = lower.indexOf('@', at + 1);
      continue;
    }

    const rest = lower.slice(at + 1);
    let match: { person: Mentionable; length: number } | null = null;

    for (const person of byFullName) {
      const name = person.name.trim().toLowerCase();
      if (name && rest.startsWith(name) && endsAt(rest, name.length)) {
        match = { person, length: name.length };
        break;
      }
    }

    if (!match) {
      const word = WORD.exec(rest)?.[0];
      const person = word ? byFirstName.get(word) : undefined;
      if (word && person) match = { person, length: word.length };
    }

    if (match) {
      const end = at + 1 + match.length;
      spans.push({ start: at, end, person: match.person });
      at = lower.indexOf('@', end);
    } else {
      at = lower.indexOf('@', at + 1);
    }
  }

  return spans;
}

/** The distinct people `text` mentions, in order of first mention. */
export function findMentions(text: string, people: readonly Mentionable[]): Mentionable[] {
  const seen = new Map<string, Mentionable>();
  for (const span of findMentionSpans(text, people)) {
    if (!seen.has(span.person.id)) seen.set(span.person.id, span.person);
  }
  return [...seen.values()];
}
