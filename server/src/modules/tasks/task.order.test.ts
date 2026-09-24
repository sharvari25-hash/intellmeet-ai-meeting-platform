import { describe, expect, it } from 'vitest';
import { MIN_ORDER_GAP, ORDER_STEP, orderBetween } from '@intellmeet/shared';

/**
 * Fractional ordering. Shared by the server (which stores the order) and the
 * client (which shows the card there before the server answers).
 */
describe('orderBetween', () => {
  it('starts an empty column at one step', () => {
    expect(orderBetween(null, null)).toBe(ORDER_STEP);
  });

  it('goes a step past either end', () => {
    expect(orderBetween(3 * ORDER_STEP, null)).toBe(4 * ORDER_STEP);
    expect(orderBetween(null, ORDER_STEP)).toBe(0);
    // Orders may go negative: dropping above the first card again and again.
    expect(orderBetween(null, 0)).toBe(-ORDER_STEP);
  });

  it('takes the midpoint between two neighbours', () => {
    expect(orderBetween(1024, 2048)).toBe(1536);
    expect(orderBetween(1024, 1025)).toBe(1024.5);
  });

  it('survives dozens of drops into the same slot before running out', () => {
    let low = 1024;
    const high = 2048;
    let drops = 0;
    for (let next = orderBetween(low, high); next !== null; next = orderBetween(low, high)) {
      expect(next).toBeGreaterThan(low);
      expect(next).toBeLessThan(high);
      low = next;
      drops += 1;
    }
    // About log2(1024 / 1e-6) = 30 halvings: rare enough that renumbering a
    // column now and then is the right trade.
    expect(drops).toBeGreaterThan(25);
  });

  it('gives up, rather than colliding, once the gap is too small', () => {
    expect(orderBetween(1, 1 + MIN_ORDER_GAP)).toBeNull();
    // Neighbours in the wrong order (a stale client) are no slot either.
    expect(orderBetween(2048, 1024)).toBeNull();
  });
});
