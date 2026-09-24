import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomControls } from './RoomControls';

function setup(overrides: Partial<Parameters<typeof RoomControls>[0]> = {}) {
  const handlers = {
    onToggleAudio: vi.fn(),
    onToggleVideo: vi.fn(),
    onToggleScreen: vi.fn(),
    onLeave: vi.fn(),
    onMuteEveryone: vi.fn(),
    onEndForEveryone: vi.fn(),
  };

  render(
    <RoomControls
      audioEnabled
      videoEnabled
      sharingScreen={false}
      isHost={false}
      {...handlers}
      {...overrides}
    />,
  );

  return { ...handlers, user: userEvent.setup() };
}

describe('<RoomControls />', () => {
  it('labels each control by what pressing it will do', () => {
    setup();

    // Not "Microphone on" - a screen-reader user needs the action, not a
    // state they then have to interpret.
    expect(screen.getByRole('button', { name: 'Turn your microphone off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn your camera off' })).toBeInTheDocument();
  });

  it('flips the label and the pressed state when muted', () => {
    setup({ audioEnabled: false });

    const button = screen.getByRole('button', { name: 'Turn your microphone on' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('wires each button to its handler', async () => {
    const { user, onToggleAudio, onToggleVideo, onLeave } = setup();

    await user.click(screen.getByRole('button', { name: 'Turn your microphone off' }));
    await user.click(screen.getByRole('button', { name: 'Turn your camera off' }));
    await user.click(screen.getByRole('button', { name: /leave/i }));

    expect(onToggleAudio).toHaveBeenCalledOnce();
    expect(onToggleVideo).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('hides the host controls from everyone else', () => {
    setup({ isHost: false });

    expect(screen.queryByRole('button', { name: /mute all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /end for all/i })).not.toBeInTheDocument();
  });

  it('shows the host controls to the host', async () => {
    const { user, onMuteEveryone, onEndForEveryone } = setup({ isHost: true });

    await user.click(screen.getByRole('button', { name: /mute all/i }));
    await user.click(screen.getByRole('button', { name: /end for all/i }));

    expect(onMuteEveryone).toHaveBeenCalledOnce();
    expect(onEndForEveryone).toHaveBeenCalledOnce();
  });

  it('hides screen sharing on a browser that cannot do it', () => {
    // jsdom has no getDisplayMedia, which is also true of iOS Safari. Offering
    // a button that can only fail is worse than not offering it.
    setup({ sharingScreen: false });

    expect(screen.queryByRole('button', { name: /share your screen/i })).not.toBeInTheDocument();
  });

  it('offers to stop sharing while a screen share is running', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
    });

    setup({ sharingScreen: true });

    expect(screen.getByRole('button', { name: 'Stop sharing your screen' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  describe('recording', () => {
    it('offers the host a Record button that flips to Stop', async () => {
      const onToggle = vi.fn();
      const { user } = setup({ isHost: true, recording: { phase: 'idle', onToggle } });

      await user.click(screen.getByRole('button', { name: 'Record' }));
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('shows a pressed Stop button while recording', () => {
      setup({ isHost: true, recording: { phase: 'recording', onToggle: vi.fn() } });

      expect(screen.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('cannot be pressed again while the file is uploading', () => {
      setup({ isHost: true, recording: { phase: 'saving', onToggle: vi.fn() } });

      expect(screen.getByRole('button', { name: /saving recording/i })).toBeDisabled();
    });

    it('is not shown to anyone but the host', () => {
      setup({ isHost: false, recording: { phase: 'idle', onToggle: vi.fn() } });

      expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
    });
  });
});
