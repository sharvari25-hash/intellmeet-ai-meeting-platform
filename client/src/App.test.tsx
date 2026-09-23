import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('<App />', () => {
  beforeEach(() => {
    // Stub the network so the test asserts rendering, not connectivity.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          service: 'intellmeet-server',
          version: '0.1.0',
          environment: 'test',
          uptimeSec: 1,
          timestamp: new Date().toISOString(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the product name and the API health panel', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'IntellMeet' })).toBeInTheDocument();
    expect(await screen.findByText('intellmeet-server')).toBeInTheDocument();
  });
});
