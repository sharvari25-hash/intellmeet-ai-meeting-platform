import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VideoTile, type VideoTileProps } from './VideoTile';

const CAMERA_ON = { audio: true, video: true, screen: false };
const CAMERA_OFF = { audio: true, video: false, screen: false };

/** jsdom has no MediaStream; the tile only ever compares it by identity. */
const fakeStream = () => ({ id: crypto.randomUUID() }) as unknown as MediaStream;

function renderTile(props: Partial<VideoTileProps> = {}) {
  const result = render(
    <VideoTile
      name="Grace Hopper"
      avatarUrl={null}
      stream={fakeStream()}
      media={CAMERA_ON}
      connectionState="connected"
      {...props}
    />,
  );

  const video = result.container.querySelector('video');
  if (!video) throw new Error('no <video> rendered');
  return { ...result, video };
}

/**
 * Simulates the first decoded frame. jsdom never decodes anything, so
 * `videoWidth` stays 0 unless a test says otherwise.
 */
function decodeFirstFrame(video: HTMLVideoElement) {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 });
  fireEvent(video, new Event('loadeddata'));
}

describe('<VideoTile />', () => {
  it('shows "Connecting…" rather than a blank box until a frame arrives', () => {
    // The remote stream exists as soon as the offer is applied, well before a
    // single frame decodes - the moment the old tile showed a grey rectangle.
    const { video } = renderTile({ connectionState: 'connecting' });

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to Grace Hopper');
    expect(video).toHaveClass('invisible');
  });

  it('keeps waiting after the connection is up if no frame has decoded yet', () => {
    renderTile({ connectionState: 'connected' });

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('reveals the video once the first frame is decoded', () => {
    const { video } = renderTile();

    decodeFirstFrame(video);

    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(video).not.toHaveClass('invisible');
  });

  it('starts waiting again when the stream is replaced', () => {
    const { video, rerender } = renderTile();
    decodeFirstFrame(video);
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 0 });

    // A rebuilt connection brings a new stream; the old one's frames say
    // nothing about it.
    rerender(
      <VideoTile
        name="Grace Hopper"
        avatarUrl={null}
        stream={fakeStream()}
        media={CAMERA_ON}
        connectionState="connected"
      />,
    );

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('shows the avatar, not a spinner, for a connected peer with the camera off', () => {
    renderTile({ media: CAMERA_OFF, connectionState: 'connected' });

    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.getByText('GH')).toBeInTheDocument();
  });

  it('never shows "Connecting…" on your own tile', () => {
    renderTile({ isSelf: true, connectionState: undefined });

    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('keeps the last picture when a live call drops, and flags the reconnect', () => {
    const { video, rerender } = renderTile();
    const stream = fakeStream();
    rerender(
      <VideoTile
        name="Grace Hopper"
        avatarUrl={null}
        stream={stream}
        media={CAMERA_ON}
        connectionState="connected"
      />,
    );
    decodeFirstFrame(video);

    rerender(
      <VideoTile
        name="Grace Hopper"
        avatarUrl={null}
        stream={stream}
        media={CAMERA_ON}
        connectionState="disconnected"
      />,
    );

    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reconnecting to Grace Hopper')).toBeInTheDocument();
  });
});
