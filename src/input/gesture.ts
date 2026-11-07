/**
 * Tells a quick tap from a press and hold (spec §7a). Pure and clock-free: every call
 * takes the time in ms, so tests drive it with fake time and main.ts with performance.now().
 *
 * - Released within TAP_MS, moved less than SLOP_PX → 'tap'.
 * - Held (and allowed to dig): after RING_DELAY_MS 'holdStart', then 'holdProgress' on each
 *   tick, and 'holdComplete' at HOLD_MS. Releasing before that, sliding more than SLOP_PX or
 *   a pointercancel gives 'cancel'.
 * - Held where holding cannot dig: no ring; a release after TAP_MS gives 'longRelease'.
 * - Only the first finger counts; others are ignored until it lifts.
 */
export const TAP_MS = 250;
export const HOLD_MS = 500;
export const SLOP_PX = 12;
/** The ring appears a moment after the finger lands, so plain taps hardly flash it. */
export const RING_DELAY_MS = 150;

export type GestureEvent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'holdStart'; x: number; y: number; progress: number }
  | { type: 'holdProgress'; x: number; y: number; progress: number }
  | { type: 'holdComplete'; x: number; y: number }
  | { type: 'longRelease'; x: number; y: number }
  | { type: 'cancel' };

interface Press {
  id: number;
  x: number;
  y: number;
  t0: number;
  canHold: boolean;
  ringShown: boolean;
  /** Finished (completed, slid away or cancelled): waits silently for the finger to lift. */
  over: boolean;
}

export class GestureClassifier {
  private press: Press | null = null;

  /** True while a finger is down (even one whose gesture is over). */
  get busy(): boolean {
    return this.press !== null;
  }

  down(id: number, x: number, y: number, t: number, canHold: boolean): GestureEvent[] {
    if (this.press) return [];
    this.press = { id, x, y, t0: t, canHold, ringShown: false, over: false };
    return [];
  }

  move(id: number, x: number, y: number, t: number): GestureEvent[] {
    const p = this.press;
    if (!p || p.id !== id || p.over) return [];
    if (Math.hypot(x - p.x, y - p.y) > SLOP_PX) {
      p.over = true;
      return [{ type: 'cancel' }];
    }
    return this.tick(t);
  }

  up(id: number, _x: number, _y: number, t: number): GestureEvent[] {
    const p = this.press;
    if (!p || p.id !== id) return [];
    this.press = null;
    if (p.over) return [];
    const held = t - p.t0;
    if (held <= TAP_MS) return [{ type: 'tap', x: p.x, y: p.y }];
    if (!p.canHold) return [{ type: 'longRelease', x: p.x, y: p.y }];
    if (held >= HOLD_MS) return [{ type: 'holdComplete', x: p.x, y: p.y }];
    return [{ type: 'cancel' }];
  }

  /** pointercancel for that finger; with no id, ends whatever is down (an overlay opened). */
  cancel(id?: number): GestureEvent[] {
    const p = this.press;
    if (!p || (id !== undefined && p.id !== id)) return [];
    this.press = null;
    return p.over ? [] : [{ type: 'cancel' }];
  }

  /** Call every frame: fills the ring and completes the hold even when the finger is still. */
  tick(t: number): GestureEvent[] {
    const p = this.press;
    if (!p || p.over || !p.canHold) return [];
    const held = t - p.t0;
    if (held >= HOLD_MS) {
      p.over = true;
      return [{ type: 'holdComplete', x: p.x, y: p.y }];
    }
    if (held < RING_DELAY_MS) return [];
    const progress = held / HOLD_MS;
    if (!p.ringShown) {
      p.ringShown = true;
      return [{ type: 'holdStart', x: p.x, y: p.y, progress }];
    }
    return [{ type: 'holdProgress', x: p.x, y: p.y, progress }];
  }
}
