/**
 * Dates and durations as the meeting pages show them, without a date
 * library: `Intl` through `toLocale*String` already follows the reader's
 * locale and time zone.
 */

/** "24 Sep 2026, 09:30", or a fallback when there is no date. */
export function formatDateTime(iso: string | null, fallback = 'Not started'): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * "Fri 18 Sep". A due date is a calendar day, not a moment: reading it at
 * local noon keeps it on the same day in every time zone.
 */
export function formatDue(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "21 min", never "0 min" for a meeting that did happen. */
export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "09:41", for a chat message's time of day. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** The moment that best describes when a meeting is or was. */
export function meetingWhen(meeting: {
  scheduledAt: string | null;
  startedAt: string | null;
  createdAt: string;
}): string {
  return meeting.startedAt ?? meeting.scheduledAt ?? meeting.createdAt;
}
