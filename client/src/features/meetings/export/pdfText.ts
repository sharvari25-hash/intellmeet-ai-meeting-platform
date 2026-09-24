/**
 * Makes text safe for the PDF's built-in fonts.
 *
 * The standard PDF fonts (Helvetica, Courier) need no font file, which keeps
 * the export instant and the bundle small, but they only have glyphs for the
 * Windows-1252 character set: Western European letters and common
 * typography. Anything else would render as garbage, so it is transliterated
 * where Unicode allows ("ş" -> "s") and replaced with "?" where it cannot be.
 * The Markdown export keeps every character; a Unicode font (a ~500 KB
 * download) is the fix if non-Latin minutes become common.
 */

/** Windows-1252 characters outside Latin-1, which the standard fonts also have. */
const CP1252_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

function isRenderable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    char === '\n' ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    CP1252_EXTRAS.has(char)
  );
}

export function toPdfText(text: string): string {
  let out = '';
  for (const char of text) {
    if (isRenderable(char)) {
      out += char;
      continue;
    }
    // Strip accents the font lacks, keeping the base letter.
    const base = char.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += [...base].every(isRenderable) && base.length > 0 ? base : '?';
  }
  return out;
}
