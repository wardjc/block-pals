import { describe, expect, it } from 'vitest';
import { GestureClassifier, HOLD_MS, RING_DELAY_MS, SLOP_PX, TAP_MS } from '../../src/input/gesture';

// All times are fake milliseconds fed in by the test: the classifier never reads a clock.
describe('GestureClassifier', () => {
  it('uses the agreed thresholds (spec §7a)', () => {
    expect(TAP_MS).toBe(250);
    expect(HOLD_MS).toBe(500);
    expect(SLOP_PX).toBe(12);
    expect(RING_DELAY_MS).toBeLessThan(TAP_MS);
  });

  it('a quick tap gives tap and nothing else', () => {
    const g = new GestureClassifier();
    expect(g.down(1, 100, 200, 1000, true)).toEqual([]);
    expect(g.tick(1080)).toEqual([]);
    expect(g.move(1, 104, 203, 1100)).toEqual([]);
    expect(g.up(1, 104, 203, 1150)).toEqual([{ type: 'tap', x: 100, y: 200 }]);
    expect(g.busy).toBe(false);
  });

  it('a tap is still a tap when the ring has just appeared', () => {
    const g = new GestureClassifier();
    g.down(1, 10, 10, 0, true);
    expect(g.tick(RING_DELAY_MS)).toEqual([{ type: 'holdStart', x: 10, y: 10, progress: RING_DELAY_MS / HOLD_MS }]);
    expect(g.up(1, 10, 10, 240)).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });

  it('a tap where holding cannot dig never shows the ring', () => {
    const g = new GestureClassifier();
    g.down(1, 10, 10, 0, false);
    expect(g.tick(200)).toEqual([]);
    expect(g.up(1, 10, 10, 220)).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });

  it('a hold fills the ring and completes at 500 ms, once', () => {
    const g = new GestureClassifier();
    g.down(7, 50, 60, 0, true);
    expect(g.tick(100)).toEqual([]);
    expect(g.tick(200)).toEqual([{ type: 'holdStart', x: 50, y: 60, progress: 0.4 }]);
    expect(g.tick(300)).toEqual([{ type: 'holdProgress', x: 50, y: 60, progress: 0.6 }]);
    expect(g.tick(499)).toEqual([{ type: 'holdProgress', x: 50, y: 60, progress: 0.998 }]);
    expect(g.tick(500)).toEqual([{ type: 'holdComplete', x: 50, y: 60 }]);
    expect(g.tick(600)).toEqual([]);
    expect(g.up(7, 50, 60, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('a hold completes on release if no frame ticked past 500 ms', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0, true);
    expect(g.up(1, 0, 0, 520)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
  });

  it('releasing at 400 ms cancels (nothing dug)', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0, true);
    g.tick(300);
    expect(g.up(1, 0, 0, 400)).toEqual([{ type: 'cancel' }]);
    expect(g.tick(600)).toEqual([]);
  });

  it('sliding 20 px cancels, and the release then does nothing', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0, true);
    g.tick(300);
    expect(g.move(1, 112, 112, 320)).toEqual([{ type: 'cancel' }]); // 17 px diagonally
    expect(g.tick(600)).toEqual([]);
    expect(g.up(1, 120, 100, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('sliding within 12 px keeps the hold', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0, true);
    expect(g.move(1, 112, 100, 300)).toEqual([{ type: 'holdStart', x: 100, y: 100, progress: 0.6 }]);
    expect(g.tick(500)).toEqual([{ type: 'holdComplete', x: 100, y: 100 }]);
  });

  it('a quick slide is not a tap', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0, false);
    expect(g.move(1, 100, 120, 50)).toEqual([{ type: 'cancel' }]);
    expect(g.up(1, 100, 120, 100)).toEqual([]);
  });

  it('a long press where holding cannot dig gives longRelease, never a ring', () => {
    const g = new GestureClassifier();
    g.down(1, 5, 5, 0, false);
    expect(g.tick(300)).toEqual([]);
    expect(g.tick(900)).toEqual([]);
    expect(g.up(1, 5, 5, 1000)).toEqual([{ type: 'longRelease', x: 5, y: 5 }]);
  });

  it('ignores a second finger while the first is down', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0, true);
    expect(g.down(2, 300, 300, 100, true)).toEqual([]);
    expect(g.move(2, 600, 600, 150)).toEqual([]);
    expect(g.up(2, 600, 600, 200)).toEqual([]);
    expect(g.tick(500)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
  });

  it('ignores a second finger that taps while the first is down', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0, false);
    g.down(2, 300, 300, 50, false);
    expect(g.up(2, 300, 300, 80)).toEqual([]);
    expect(g.up(1, 0, 0, 120)).toEqual([{ type: 'tap', x: 0, y: 0 }]);
  });

  it('pointercancel cancels the hold', () => {
    const g = new GestureClassifier();
    g.down(3, 0, 0, 0, true);
    g.tick(300);
    expect(g.cancel(3)).toEqual([{ type: 'cancel' }]);
    expect(g.tick(600)).toEqual([]);
    expect(g.up(3, 0, 0, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('pointercancel during a would-be tap gives cancel, not tap', () => {
    const g = new GestureClassifier();
    g.down(3, 0, 0, 0, false);
    expect(g.cancel(3)).toEqual([{ type: 'cancel' }]);
    expect(g.up(3, 0, 0, 100)).toEqual([]);
  });

  it('cancel() with no id ends whatever is down (an overlay opened)', () => {
    const g = new GestureClassifier();
    g.down(9, 0, 0, 0, true);
    expect(g.cancel()).toEqual([{ type: 'cancel' }]);
    expect(g.busy).toBe(false);
    expect(g.cancel()).toEqual([]);
  });

  it('a new press works after each kind of ending', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0, true); g.tick(500); g.up(1, 0, 0, 600);
    g.down(2, 0, 0, 1000, true); g.up(2, 0, 0, 1400);
    g.down(3, 0, 0, 2000, true); g.move(3, 50, 0, 2100); g.up(3, 50, 0, 2200);
    g.down(4, 0, 0, 3000, true); g.cancel(4);
    g.down(5, 1, 2, 4000, true);
    expect(g.up(5, 1, 2, 4100)).toEqual([{ type: 'tap', x: 1, y: 2 }]);
  });
});
