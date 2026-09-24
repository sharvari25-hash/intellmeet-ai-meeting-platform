import type { AiStatus } from '@intellmeet/shared';

/** How each pipeline step reads to a person, not to the job queue. */
export const AI_STATUS_LABEL: Record<AiStatus, string> = {
  none: 'No recording',
  queued: 'Waiting to process',
  transcribing: 'Transcribing',
  summarizing: 'Summarizing',
  done: 'Summary ready',
  failed: 'Processing failed',
};

export function isAiInProgress(status: AiStatus): boolean {
  return status === 'queued' || status === 'transcribing' || status === 'summarizing';
}

/** Ordered steps for the progress list on the meeting page. */
export const AI_STEPS: { status: AiStatus; label: string }[] = [
  { status: 'queued', label: 'Recording received' },
  { status: 'transcribing', label: 'Transcribing the audio' },
  { status: 'summarizing', label: 'Writing the summary and action items' },
];

/** "1:05:09" or "05:09", for transcript timestamps and durations. */
export function formatOffset(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
