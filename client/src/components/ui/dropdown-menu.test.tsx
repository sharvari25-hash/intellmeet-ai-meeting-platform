import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

/**
 * A browser keeps a closed menu on the page while it fades out (150 ms), and
 * Radix waits for the animation to end before removing it. jsdom runs no
 * animations, so the menu would vanish at once and the bug below could not
 * happen. This reports an exit animation for a closed menu, as a browser
 * would, and never ends it, so the menu stays mid-fade for the whole test.
 */
function keepClosingMenusOnThePage() {
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computedStyle(element, pseudo);
    if (!(element instanceof HTMLElement) || element.dataset.slot !== 'dropdown-menu-content') {
      return style;
    }
    return new Proxy(style, {
      get(target, property) {
        if (property === 'animationName') {
          return element.dataset.state === 'closed' ? 'exit' : 'enter';
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
}

function Menu({ label }: { label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>{label}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>{`${label}: first`}</DropdownMenuItem>
        <DropdownMenuItem>{`${label}: second`}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('<DropdownMenu />', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens again when its button is pressed while it is still fading out', async () => {
    keepClosingMenusOnThePage();
    const user = userEvent.setup();
    render(<Menu label="Export" />);
    const button = screen.getByRole('button', { name: 'Export' });

    await user.click(button);
    await user.click(screen.getByRole('menuitem', { name: 'Export: first' }));
    // Chosen, closed, and still on the page: the moment CI pressed it again.
    expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'closed');

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toHaveAttribute('data-state', 'open');
    await user.click(screen.getByRole('menuitem', { name: 'Export: second' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('still closes when the button of an open menu is pressed', async () => {
    const user = userEvent.setup();
    render(<Menu label="Export" />);
    const button = screen.getByRole('button', { name: 'Export' });

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it("still closes when another menu's button is pressed", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu label="Export" />
        <Menu label="Theme" />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('button', { name: 'Theme' }));

    expect(screen.getByRole('button', { name: 'Export' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });
});
