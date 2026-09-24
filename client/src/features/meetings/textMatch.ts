import { searchTerms, termPattern } from '@intellmeet/shared';

export interface TextPart {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into the stretches a search for `query` matches and the
 * stretches between them.
 *
 * Uses the shared term rules, so the words highlighted are the words the
 * server's snippet was chosen for - "planning" lights up "planned" in both.
 */
export function splitByQuery(text: string, query: string): TextPart[] {
  const pattern = termPattern(searchTerms(query));
  if (!pattern) return [{ text, match: false }];

  const parts: TextPart[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });

  return parts.length > 0 ? parts : [{ text, match: false }];
}

/** Whether `text` contains anything a search for `query` matches. */
export function matchesQuery(text: string, query: string): boolean {
  const pattern = termPattern(searchTerms(query));
  return pattern ? pattern.test(text) : false;
}
