/**
 * Due dates are calendar days (`YYYY-MM-DD`), compared as strings against
 * the reader's own today: a task due "Friday" is overdue from Saturday
 * wherever the reader is.
 */

/** Today in the reader's time zone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Past its due date and not in a "done" column. */
export function isOverdue(dueDate: string | null, done: boolean, today = todayIso()): boolean {
  return !done && dueDate !== null && dueDate < today;
}
