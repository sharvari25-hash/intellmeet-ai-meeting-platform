import { beforeEach, describe, expect, it, vi } from 'vitest';
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
