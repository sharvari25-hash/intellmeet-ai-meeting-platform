import { useMemo } from 'react';
import { splitByQuery } from './textMatch';

/**
 * Text with every word a search matches wrapped in `<mark>`, which screen
 * readers can announce as highlighted. Plain text when there is no query.
 */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitByQuery(text, query), [text, query]);

  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
