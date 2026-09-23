import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

const healthPayload = {
  status: 'ok',
  service: 'intellmeet-server',
  version: '0.1.0',
  environment: 'test',
  uptimeSec: 1,
  timestamp: new Date().toISOString(),
  dependencies: {
    mongo: { status: 'up', latencyMs: 3 },
    redis: { status: 'up', latencyMs: 1 },
  },
};

describe('<App />', () => {
  beforeEach(() => {
    // Stub the network so the test asserts rendering, not connectivity.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(healthPayload)),
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

  it('renders a row per backing dependency', async () => {
    render(<App />);

    expect(await screen.findByText('MongoDB')).toBeInTheDocument();
    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('(3ms)')).toBeInTheDocument();
  });

  it('surfaces a degraded backend instead of claiming everything is fine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...healthPayload,
          status: 'degraded',
          dependencies: {
            ...healthPayload.dependencies,
            redis: { status: 'down', error: 'client not connected' },
          },
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('degraded')).toBeInTheDocument();
    expect(screen.getByText('down')).toBeInTheDocument();
  });
});
