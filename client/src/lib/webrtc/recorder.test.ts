import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * jsdom has neither Web Audio nor MediaRecorder, so both are faked. What is
 * under test is the mixing bookkeeping - one source per participant, added
 * and removed as people come and go - and the file that comes out.
 */

class FakeSource {
  connected = false;
  constructor(readonly stream: MediaStream) {}
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
}

const createdSources: FakeSource[] = [];

const fakeContext = {
  state: 'running',
  resume: vi.fn(),
  createMediaStreamDestination: () => ({ stream: { id: 'mix' } }),
  createMediaStreamSource: (stream: MediaStream) => {
    const source = new FakeSource(stream);
    createdSources.push(source);
    return source;
  },
};

vi.mock('./audioLevel', () => ({ getAudioContext: () => fakeContext }));

class FakeMediaRecorder extends EventTarget {
  static supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }
  static last: FakeMediaRecorder | null = null;

  state: 'inactive' | 'recording' = 'inactive';
  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions,
  ) {
    super();
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    const data = Object.assign(new Event('dataavailable'), { data: new Blob(['chunk']) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event('stop'));
  }
}

const withAudio = (id: string) =>
  ({ id, getAudioTracks: () => [{ kind: 'audio' }] }) as unknown as MediaStream;
const withoutAudio = (id: string) => ({ id, getAudioTracks: () => [] }) as unknown as MediaStream;

beforeEach(() => {
  createdSources.length = 0;
  FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { MeetingRecorder, pickRecordingMimeType, RECORDING_BITRATE } = await import('./recorder');

describe('pickRecordingMimeType', () => {
  it('prefers WebM/Opus', () => {
    expect(pickRecordingMimeType()).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4 where that is all there is (Safari)', () => {
    FakeMediaRecorder.supported = new Set(['audio/mp4']);
    expect(pickRecordingMimeType()).toBe('audio/mp4');
  });
});

describe('MeetingRecorder', () => {
  it('records the mix at a speech bitrate', () => {
    new MeetingRecorder();
    expect(FakeMediaRecorder.last?.options).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: RECORDING_BITRATE,
    });
    expect(FakeMediaRecorder.last?.stream).toEqual({ id: 'mix' });
  });

  it('mixes one source per participant, following joins and leaves', () => {
    const recorder = new MeetingRecorder();
    const self = withAudio('self');
    const ada = withAudio('ada');

    recorder.setStreams(
      new Map([
        ['self', self],
        ['ada', ada],
      ]),
    );
    expect(recorder.sourceCount).toBe(2);

    // Ada leaves; Grace joins.
    recorder.setStreams(
      new Map([
        ['self', self],
        ['grace', withAudio('grace')],
      ]),
    );
    expect(recorder.sourceCount).toBe(2);
    expect(createdSources.find((source) => source.stream === ada)?.connected).toBe(false);

    // Setting the same streams again adds nothing.
    recorder.setStreams(new Map([['self', self]]));
    expect(createdSources).toHaveLength(3);
  });

  it('skips a stream with no audio instead of failing the recording', () => {
    const recorder = new MeetingRecorder();
    recorder.setStreams(new Map([['camera-only', withoutAudio('x')]]));
    expect(recorder.sourceCount).toBe(0);
  });

  it('hands back one file, typed without codec parameters, and detaches the mix', async () => {
    const recorder = new MeetingRecorder();
    recorder.setStreams(new Map([['self', withAudio('self')]]));
    recorder.start();

    const finished = await recorder.stop();

    expect(finished.blob.type).toBe('audio/webm');
    expect(finished.blob.size).toBeGreaterThan(0);
    expect(finished.durationSec).toBeGreaterThanOrEqual(0);
    expect(createdSources.every((source) => !source.connected)).toBe(true);
  });

  it('refuses to stop something that never started', async () => {
    await expect(new MeetingRecorder().stop()).rejects.toThrow(/not running/);
  });
});
