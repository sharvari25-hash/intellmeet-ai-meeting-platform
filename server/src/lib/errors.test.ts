import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';

describe('AppError.isClientSafe (what production shows the caller)', () => {
  it('shows 4xx messages, which are written for the caller', () => {
    expect(AppError.badRequest('The title is required').isClientSafe).toBe(true);
    expect(AppError.tooManyRequests('Slow down').isClientSafe).toBe(true);
  });

  it('hides 500 messages, which describe internals', () => {
    expect(AppError.internal('connection refused at 10.0.0.3:27017').isClientSafe).toBe(false);
  });

  it('shows 503 messages, which are only ever thrown on purpose for the person reading them', () => {
    // "Internal server error" in their place reads like a crash to a judge
    // who has only hit the demo's guest ceiling.
    expect(
      AppError.unavailable('The demo is busy right now. Please try again in a few minutes.')
        .isClientSafe,
    ).toBe(true);
  });
});
