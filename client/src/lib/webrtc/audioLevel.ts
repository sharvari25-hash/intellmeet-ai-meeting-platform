/**
 * Measures how loudly a stream is speaking, for the lobby's mic meter and the
 * room's active-speaker highlight.
 *
 * One shared `AudioContext` for the whole page. Browsers cap how many a
 * document may create (Chrome allows six), and a six-person call with a
 * context per tile would hit that ceiling and then silently fail - so the
 * context is created once and every meter hangs an analyser off it.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (sharedContext) return sharedContext;

  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    // Web Audio can be unavailable entirely (older WebViews, locked-down
    // browsers). Meters then read zero and the UI simply never highlights.
    return null;
  }
}

export interface LevelMeter {
  /** Current loudness from 0 to 1. Returns 0 when measurement is unavailable. */
  read: () => number;
  stop: () => void;
}

const SILENT: LevelMeter = { read: () => 0, stop: () => undefined };

export function createLevelMeter(stream: MediaStream): LevelMeter {
  const context = getContext();
  if (!context || stream.getAudioTracks().length === 0) return SILENT;

  // An autoplay policy can leave the context suspended until a user gesture.
  // Joining a call is a gesture, so this usually resolves immediately.
  if (context.state === 'suspended') void context.resume();

  let source: MediaStreamAudioSourceNode;
  try {
    source = context.createMediaStreamSource(stream);
  } catch {
    return SILENT;
  }

  const analyser = context.createAnalyser();
  // Small FFT: this is a loudness meter, not a spectrum display, and a smaller
  // buffer means less work per frame on a phone.
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  let stopped = false;

  return {
    read: () => {
      if (stopped) return 0;

      analyser.getByteTimeDomainData(samples);

      // RMS of the waveform around the 128 midpoint. Peak amplitude would
      // flicker on every consonant; RMS tracks perceived loudness closely
      // enough to drive a meter and an active-speaker pick.
      let sumSquares = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sumSquares += centred * centred;
      }

      const rms = Math.sqrt(sumSquares / samples.length);

      // Speech sits low in this range, so scale up and clamp rather than
      // showing a meter that never leaves the first tenth.
      return Math.min(1, rms * 3.5);
    },
    stop: () => {
      stopped = true;
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // Already torn down with the stream.
      }
    },
  };
}

/** Loudness above which somebody counts as speaking rather than breathing. */
export const SPEAKING_THRESHOLD = 0.12;
