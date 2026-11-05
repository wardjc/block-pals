import { describe, expect, it } from 'vitest';
import { HoldGate } from '../../src/core/gate';

describe('HoldGate', () => {
  it('completes after the hold time, once', () => {
    const g = new HoldGate(3000);
    g.start(1000);
    expect(g.poll(3999)).toBe(false);
    expect(g.progress(2500)).toBeCloseTo(0.5);
    expect(g.poll(4000)).toBe(true);
    expect(g.poll(5000)).toBe(false);
    expect(g.active).toBe(false);
  });
  it('release early cancels', () => {
    const g = new HoldGate(3000);
    g.start(0);
    g.release();
    expect(g.poll(5000)).toBe(false);
    expect(g.progress(5000)).toBe(0);
  });
  it('can be held again after cancelling', () => {
    const g = new HoldGate(3000);
    g.start(0);
    g.release();
    g.start(10000);
    expect(g.poll(13000)).toBe(true);
  });
});
