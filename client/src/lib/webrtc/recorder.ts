import { getAudioContext } from './audioLevel';

/**
 * Records a meeting's audio: every participant's voice, mixed into one track.
 *
 * In a mesh there is no server that hears everyone, so the host's browser is
 * the one place where all the audio meets. Each stream - the host's own
 * microphone and every remote peer - becomes a source node on one Web Audio
 * graph, all feeding a single `MediaStreamAudioDestinationNode`. That
 * destination's stream is what `MediaRecorder` encodes.
 *
 * Audio only, Opus at ~32 kbps: speech is what the transcript needs, and an
 * hour is ~14 MB - under the transcription API's 25 MB limit without
 * splitting, and gentle on a free Cloudinary account.
 *
 * Nothing here is played back: the mix goes to the recorder, not to the
 * speakers, so the host does not hear everyone twice.
 */

/** Container/codec preferences, best first. Safari only does MP4. */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export const RECORDING_BITRATE = 32_000;

export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function recordingSupported(): boolean {
  return pickRecordingMimeType() !== null && getAudioContext() !== null;
}

export interface FinishedRecording {
  blob: Blob;
  durationSec: number;
  mimeType: string;
}

export class MeetingRecorder {
  private readonly context: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly sources = new Map<
    string,
    { stream: MediaStream; node: MediaStreamAudioSourceNode }
  >();
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly mimeType: string;
  private startedAt = 0;

  constructor() {
    const context = getAudioContext();
    const mimeType = pickRecordingMimeType();
    if (!context || !mimeType) throw new Error('Recording is not supported in this browser.');

    this.context = context;
    this.mimeType = mimeType;
    this.destination = context.createMediaStreamDestination();
    this.recorder = new MediaRecorder(this.destination.stream, {
      mimeType,
      audioBitsPerSecond: RECORDING_BITRATE,
    });
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
  }

  /**
   * Makes the mix contain exactly these streams, keyed by who they belong to.
   *
   * Called whenever someone joins or leaves, so a participant who arrives
   * mid-recording is heard from then on, and one who leaves is disconnected
   * rather than kept as a dangling node.
   */
  setStreams(streams: Map<string, MediaStream>): void {
    for (const [key, entry] of this.sources) {
      if (streams.get(key) !== entry.stream) {
        entry.node.disconnect();
        this.sources.delete(key);
      }
    }

    for (const [key, stream] of streams) {
      if (this.sources.has(key) || stream.getAudioTracks().length === 0) continue;
      try {
        const node = this.context.createMediaStreamSource(stream);
        node.connect(this.destination);
        this.sources.set(key, { stream, node });
      } catch {
        // A stream whose audio track has ended cannot be a source. Skipping it
        // loses one voice rather than the whole recording.
      }
    }
  }

  get sourceCount(): number {
    return this.sources.size;
  }

  start(): void {
    // The context may still be suspended by the autoplay policy; pressing
    // Record is a user gesture, so resuming now is allowed.
    if (this.context.state === 'suspended') void this.context.resume();

    this.startedAt = performance.now();
    // A timeslice, so a crash an hour in loses seconds of audio, not the hour.
    this.recorder.start(10_000);
  }

  /** Stops, detaches every source and returns the finished file. */
  stop(): Promise<FinishedRecording> {
    return new Promise((resolve, reject) => {
      if (this.recorder.state === 'inactive') {
        reject(new Error('The recorder was not running.'));
        return;
      }

      this.recorder.addEventListener(
        'stop',
        () => {
          for (const entry of this.sources.values()) entry.node.disconnect();
          this.sources.clear();

          resolve({
            // The container without codec parameters, which is what upload
            // endpoints and the server's content-type check expect.
            blob: new Blob(this.chunks, { type: this.mimeType.split(';')[0] }),
            durationSec: Math.round((performance.now() - this.startedAt) / 1000),
            mimeType: this.mimeType,
          });
        },
        { once: true },
      );

      this.recorder.stop();
    });
  }
}
