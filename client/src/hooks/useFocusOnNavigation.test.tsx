import { useEffect, useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { useFocusOnNavigation } from './useFocusOnNavigation';

/** The app shell's shape: a nav that stays, and a main whose page changes. */
function Shell() {
  const main = useRef<HTMLElement>(null);
  useFocusOnNavigation(main);
  return (
    <>
      <nav aria-label="Main">
        <Link to="/app/tasks">Tasks</Link>
      </nav>
      <main ref={main}>
        <Routes>
          <Route path="/app" element={<h1>Welcome back</h1>} />
          <Route path="/app/room" element={<EndedScreen />} />
          <Route path="/app/tasks" element={<h1>Team board</h1>} />
          <Route path="/app/meetings/1" element={<SlowPage />} />
        </Routes>
      </main>
    </>
  );
}

function EndedScreen() {
  const navigate = useNavigate();
  return (
    <>
      <h1>The meeting has ended</h1>
      <button onClick={() => navigate('/app/meetings/1')}>Summary and action items</button>
      <button onClick={() => navigate('/app')}>Back to the dashboard</button>
    </>
  );
}

/** A page whose heading arrives with its data. */
function SlowPage() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(timer);
  }, []);
  return loaded ? <h1>Weekly sync</h1> : <p>Loading</p>;
}

function renderAt(path: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell />
    </MemoryRouter>,
  );
  return user;
}

describe('useFocusOnNavigation', () => {
  it('puts focus on the new page’s heading when the control that navigated is gone', async () => {
    const user = renderAt('/app/room');
    screen.getByRole('button', { name: 'Back to the dashboard' }).focus();

    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toHaveFocus();
  });

  it('waits for a heading that arrives with the page’s data', async () => {
    const user = renderAt('/app/room');
    screen.getByRole('button', { name: 'Summary and action items' }).focus();

    await user.keyboard('{Enter}');
    expect(document.body).toHaveFocus();

    expect(await screen.findByRole('heading', { name: 'Weekly sync' })).toHaveFocus();
  });

  it('leaves focus where it is when the navigation did not take it away', async () => {
    const user = renderAt('/app');
    const tasks = screen.getByRole('link', { name: 'Tasks' });
    tasks.focus();

    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: 'Team board' })).toBeInTheDocument();
    expect(tasks).toHaveFocus();
  });

  it('does not move focus on the first page, so Tab still starts at the top', () => {
    renderAt('/app');

    expect(document.body).toHaveFocus();
  });
});
