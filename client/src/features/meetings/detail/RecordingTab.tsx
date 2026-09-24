import { Download, Mic } from 'lucide-react';
import type { Meeting } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { fileNameFrom } from '@/lib/download';
import { formatOffset } from '../aiStatus';
import { RecordingPlayer } from './TranscriptTab';
import type { RecordingSource } from './useRecordingSource';

/**
 * The meeting's audio.
 *
 * A native `<audio>` element rather than Cloudinary's video player: the
 * recording is audio only (the transcript is what the AI needs), and the
 * browser's own player is keyboard- and screen-reader-accessible with no
 * extra script. It plays a Cloudinary URL directly and a locally stored
 * recording through an authenticated download.
 */
export function RecordingTab({ meeting, source }: { meeting: Meeting; source: RecordingSource }) {
  const recording = meeting.recording;

  return (
    <section aria-labelledby="recording-heading" className="rounded-xl border bg-card p-5">
      <h2 id="recording-heading" className="flex items-center gap-2 font-semibold">
        <Mic aria-hidden="true" className="size-4 text-primary" />
        Recording
      </h2>

      {!recording ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {meeting.aiStatus === 'done'
            ? 'This meeting has a transcript but no audio - it was created from sample data.'
            : 'This meeting was not recorded. The host can record from the meeting room while it is live.'}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Audio of the whole call, {formatOffset(recording.durationSec)} long. Jump to a moment
            from the timestamps in the transcript.
          </p>
          <RecordingPlayer source={source} className="mt-4" />
          {source.status === 'ready' && (
            <Button asChild variant="outline" size="sm" className="mt-4">
              <a href={source.src} download={fileNameFrom(meeting.title, 'webm')}>
                <Download aria-hidden="true" />
                Download the audio
              </a>
            </Button>
          )}
        </>
      )}
    </section>
  );
}
