import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '@intellmeet/shared';
import { ChatPanel } from './ChatPanel';

const people = [
  { id: '507f1f77bcf86cd799439014', name: 'Grace Hopper' },
  { id: '507f1f77bcf86cd799439015', name: 'Alan Turing' },
];

function message(text: string): ChatMessage {
  return {
    id: '507f1f77bcf86cd799439021',
    meetingId: '507f1f77bcf86cd799439011',
    senderId: '507f1f77bcf86cd799439015',
    senderName: 'Alan Turing',
    senderAvatarUrl: null,
    text,
    createdAt: '2026-09-24T10:00:00.000Z',
  };
}

beforeEach(() => {
  // jsdom does no layout, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Takes animation frames out of the clock's hands: callbacks wait until the
 * test calls the returned function, which is "a frame passes". Frames arrive
 * whenever the browser gets round to them - later still when the main thread
 * is busy with a call's video - so a correct caret must not depend on when.
 */
function holdAnimationFrames(): () => void {
  const pending: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pending.push(callback);
    return pending.length;
  });
  return () => {
    for (const callback of pending.splice(0)) callback(performance.now());
  };
}

function renderPanel(messages: ChatMessage[] = []) {
  const onSend = vi.fn();
  render(
    <ChatPanel
      messages={messages}
      typingNames={[]}
      selfUserId="507f1f77bcf86cd799439011"
      onSend={onSend}
      onTyping={() => {}}
      people={people}
    />,
  );
  return { onSend, user: userEvent.setup() };
}

describe('<ChatPanel /> @mentions', () => {
  it('suggests team-mates after an @, and Enter picks one instead of sending', async () => {
    const { onSend, user } = renderPanel();
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, 'Thanks @gr');

    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Grace Hopper']);
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);

    await user.keyboard('{Enter}');
    expect(input).toHaveValue('Thanks @Grace Hopper ');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(input, 'can you check?{Enter}');
    expect(onSend).toHaveBeenCalledWith('Thanks @Grace Hopper can you check?');
  });

  it('keeps typing after the name when a frame passes mid-word (a fast typist, a busy tab)', async () => {
    const frame = holdAnimationFrames();
    const { onSend, user } = renderPanel();
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, 'Thanks @gr');
    await user.keyboard('{Enter}');
    // The next key is already on its way when the frame after the choice
    // arrives - the order CI hit, and a queued keystroke in a busy call.
    // (`skipClick`: `type` clicks first by default, which a typist does not.)
    await user.type(input, 'c', { skipClick: true });
    frame();
    await user.type(input, 'an you check?{Enter}', { skipClick: true });

    expect(onSend).toHaveBeenCalledWith('Thanks @Grace Hopper can you check?');
  });

  it('puts the caret straight after a name chosen mid-sentence', async () => {
    holdAnimationFrames();
    const { user } = renderPanel();
    const input = screen.getByRole('textbox', { name: 'Message' });

    await user.type(input, 'Hi  and bye');
    // Back to between the two spaces, and mention somebody there.
    await user.keyboard('{ArrowLeft>8/}');
    await user.type(input, '@gr', { skipClick: true });
    await user.keyboard('{Enter}');
    // No frame has passed: the caret must already be after the name.
    await user.type(input, 'x', { skipClick: true });

    expect(input).toHaveValue('Hi @Grace Hopper x and bye');
  });

  it('moves through suggestions with the arrow keys, and Escape closes them', async () => {
    const { user } = renderPanel();
    const input = screen.getByRole('textbox', { name: 'Message' });

    // Matches the start of any word: "t" is Alan Turing.
    await user.type(input, '@');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picks out the mentions in a message', () => {
    renderPanel([message('@Grace Hopper can you take the notes?')]);

    const mention = screen.getByText('@Grace Hopper');
    expect(mention).toHaveClass('text-primary');
  });
});
