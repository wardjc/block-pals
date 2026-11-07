import { describe, expect, it } from 'vitest';
import { GestureClassifier, HOLD_MS, RING_DELAY_MS, SLOP_PX, STALE_MS } from '../../src/input/gesture';

// All times are fake milliseconds fed in by the test: the classifier never reads a clock.
// `tick(t, canDig)` is told each frame whether holding here would dig right now.
describe('GestureClassifier', () => {
  it('uses the agreed thresholds (spec §7a, fix round 1)', () => {
    expect(HOLD_MS).toBe(500);
    expect(SLOP_PX).toBe(12);
    expect(RING_DELAY_MS).toBe(200);
    expect(STALE_MS).toBe(2000);
  });

  it('a quick tap gives tap at the release point', () => {
    const g = new GestureClassifier();
    expect(g.down(1, 100, 200, 1000)).toEqual([]);
    expect(g.tick(1080, true)).toEqual([]);
    expect(g.move(1, 104, 203, 1100)).toEqual([]);
    expect(g.up(1, 104, 203, 1150)).toEqual([{ type: 'tap', x: 104, y: 203 }]);
    expect(g.busy).toBe(false);
  });

  it('release at 400 ms is a tap, even after the ring started', () => {
    const g = new GestureClassifier();
    g.down(1, 10, 10, 0);
    expect(g.tick(RING_DELAY_MS, true)).toEqual([{ type: 'holdStart', x: 10, y: 10, progress: 0.4 }]);
    expect(g.tick(300, true)).toEqual([{ type: 'holdProgress', x: 10, y: 10, progress: 0.6 }]);
    expect(g.up(1, 11, 9, 400)).toEqual([{ type: 'tap', x: 11, y: 9 }]);
  });

  it('a slow press where holding cannot dig is a tap and never shows the ring', () => {
    const g = new GestureClassifier();
    g.down(1, 10, 10, 0);
    expect(g.tick(300, false)).toEqual([]);
    expect(g.tick(450, false)).toEqual([]);
    expect(g.up(1, 10, 10, 499)).toEqual([{ type: 'tap', x: 10, y: 10 }]);
  });

  it('no ring before 200 ms', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.tick(199, true)).toEqual([]);
  });

  it('a hold fills the ring and completes at 500 ms, once', () => {
    const g = new GestureClassifier();
    g.down(7, 50, 60, 0);
    expect(g.tick(100, true)).toEqual([]);
    expect(g.tick(250, true)).toEqual([{ type: 'holdStart', x: 50, y: 60, progress: 0.5 }]);
    expect(g.tick(499, true)).toEqual([{ type: 'holdProgress', x: 50, y: 60, progress: 0.998 }]);
    expect(g.tick(500, true)).toEqual([{ type: 'holdComplete', x: 50, y: 60 }]);
    expect(g.tick(600, true)).toEqual([]);
    expect(g.up(7, 50, 60, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('a block that comes into reach during the hold starts the ring then and completes at 500 ms', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.tick(250, false)).toEqual([]);
    expect(g.tick(350, true)).toEqual([{ type: 'holdStart', x: 0, y: 0, progress: 0.7 }]);
    expect(g.tick(500, true)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
  });

  it('the ring goes away if the block stops being diggable mid-hold', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    g.tick(250, true);
    expect(g.tick(300, false)).toEqual([{ type: 'holdStop' }]);
    expect(g.tick(350, false)).toEqual([]);
    expect(g.tick(400, true)).toEqual([{ type: 'holdStart', x: 0, y: 0, progress: 0.8 }]);
  });

  it('a hold where holding cannot dig still completes at 500 ms (the game walks next to a far block)', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.tick(300, false)).toEqual([]);
    expect(g.tick(520, false)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
    expect(g.up(1, 0, 0, 600)).toEqual([]);
  });

  it('a hold completes on release if no frame ticked past 500 ms', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.up(1, 3, 3, 520)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
  });

  it('sliding 20 px cancels, and the release then does nothing', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0);
    g.tick(300, true);
    // 17 px diagonally: the hold ends and the slide becomes a camera drag (spec §7c).
    expect(g.move(1, 112, 112, 320)).toEqual([{ type: 'cancel' }, { type: 'drag', dx: 12, dy: 12 }]);
    expect(g.tick(600, true)).toEqual([]);
    expect(g.up(1, 120, 100, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('sliding within 12 px keeps the hold', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 112, 100, 300)).toEqual([]);
    expect(g.tick(500, true)).toEqual([{ type: 'holdComplete', x: 100, y: 100 }]);
  });

  it('a quick slide is not a tap', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 100, 120, 50)).toEqual([{ type: 'cancel' }, { type: 'drag', dx: 0, dy: 20 }]);
    expect(g.up(1, 100, 120, 100)).toEqual([]);
  });

  it('a slide turns into a drag: each move gives the step since the last one, and the release gives nothing', () => {
    const g = new GestureClassifier();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 105, 100, 10)).toEqual([]);
    expect(g.move(1, 130, 95, 20)).toEqual([{ type: 'cancel' }, { type: 'drag', dx: 30, dy: -5 }]);
    expect(g.move(1, 170, 95, 30)).toEqual([{ type: 'drag', dx: 40, dy: 0 }]);
    expect(g.move(1, 170, 95, 40)).toEqual([]);
    expect(g.move(1, 160, 115, 50)).toEqual([{ type: 'drag', dx: -10, dy: 20 }]);
    expect(g.dragging).toBe(true);
    expect(g.tick(900, true)).toEqual([]); // a long drag never completes a hold
    expect(g.up(1, 160, 115, 1000)).toEqual([]);
    expect(g.dragging).toBe(false);
    expect(g.busy).toBe(false);
  });

  it('a second finger never drags', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    g.move(1, 50, 0, 10);
    expect(g.move(2, 300, 300, 20)).toEqual([]);
    expect(g.move(1, 60, 0, 30)).toEqual([{ type: 'drag', dx: 10, dy: 0 }]);
  });

  it('pointercancel ends a drag quietly', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    g.move(1, 50, 0, 10);
    expect(g.cancel(1)).toEqual([]);
    expect(g.dragging).toBe(false);
    expect(g.move(1, 90, 0, 20)).toEqual([]);
  });

  it('ignores a second finger while the first is down', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.down(2, 300, 300, 100)).toEqual([]);
    expect(g.activeId).toBe(1);
    expect(g.move(2, 600, 600, 150)).toEqual([]);
    expect(g.up(2, 600, 600, 200)).toEqual([]);
    expect(g.tick(500, true)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
  });

  it('ignores a second finger that taps while the first is down', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    g.down(2, 300, 300, 50);
    expect(g.up(2, 300, 300, 80)).toEqual([]);
    expect(g.up(1, 0, 0, 120)).toEqual([{ type: 'tap', x: 0, y: 0 }]);
  });

  it('drops a press older than 2 s whose release was lost, and takes the new one', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.tick(500, true)).toEqual([{ type: 'holdComplete', x: 0, y: 0 }]);
    expect(g.down(2, 50, 50, 1999)).toEqual([]); // still young: ignored
    expect(g.down(2, 50, 50, 2001)).toEqual([]); // stale (already over at 500 ms): dropped quietly
    expect(g.up(2, 50, 50, 2100)).toEqual([{ type: 'tap', x: 50, y: 50 }]);
    expect(g.up(1, 0, 0, 2200)).toEqual([]);
  });

  it('a stale press that never ticked is dropped with a cancel', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0);
    expect(g.down(2, 50, 50, 2500)).toEqual([{ type: 'cancel' }]);
    expect(g.busy).toBe(true);
    expect(g.activeId).toBe(2);
    expect(g.up(2, 50, 50, 2600)).toEqual([{ type: 'tap', x: 50, y: 50 }]);
  });

  it('pointercancel cancels the hold', () => {
    const g = new GestureClassifier();
    g.down(3, 0, 0, 0);
    g.tick(300, true);
    expect(g.cancel(3)).toEqual([{ type: 'cancel' }]);
    expect(g.tick(600, true)).toEqual([]);
    expect(g.up(3, 0, 0, 700)).toEqual([]);
    expect(g.busy).toBe(false);
  });

  it('pointercancel during a would-be tap gives cancel, not tap', () => {
    const g = new GestureClassifier();
    g.down(3, 0, 0, 0);
    expect(g.cancel(3)).toEqual([{ type: 'cancel' }]);
    expect(g.up(3, 0, 0, 100)).toEqual([]);
  });

  it('cancel() with no id ends whatever is down (overlay opened, window lost focus)', () => {
    const g = new GestureClassifier();
    g.down(9, 0, 0, 0);
    expect(g.cancel()).toEqual([{ type: 'cancel' }]);
    expect(g.busy).toBe(false);
    expect(g.cancel()).toEqual([]);
  });

  it('a new press works after each kind of ending', () => {
    const g = new GestureClassifier();
    g.down(1, 0, 0, 0); g.tick(500, true); g.up(1, 0, 0, 600);
    g.down(2, 0, 0, 1000); g.up(2, 0, 0, 1400);
    g.down(3, 0, 0, 2000); g.move(3, 50, 0, 2100); g.up(3, 50, 0, 2200);
    g.down(4, 0, 0, 3000); g.cancel(4);
    g.down(5, 1, 2, 4000);
    expect(g.up(5, 1, 2, 4100)).toEqual([{ type: 'tap', x: 1, y: 2 }]);
  });
});
