/**
 * Tells a tap from a press and hold (spec §7a, fix round 1). Pure and clock-free: every
 * call takes the time in ms, so tests drive it with fake time and main.ts with performance.now().
 *
 * - Any release before HOLD_MS that never slid more than SLOP_PX → 'tap' (at the release point),
 *   whether or not the ring had started.
 * - Each frame `tick(t, canDig)` is told whether holding here would dig right now. While it
 *   would, from RING_DELAY_MS the ring shows ('holdStart', then 'holdProgress'); if it stops
 *   being diggable the ring goes ('holdStop'). The block may come into reach mid-hold.
 * - At HOLD_MS 'holdComplete' whatever canDig says: the game decides (dig, walk beside a far
 *   block, or nothing).
 * - Sliding more than SLOP_PX, a pointercancel or cancel() → 'cancel'.
 * - Only the first finger counts. A press older than STALE_MS is assumed to have lost its
 *   release and is dropped when a new finger lands.
 */
export const HOLD_MS = 500;
export const SLOP_PX = 12;
export const RING_DELAY_MS = 200;
export const STALE_MS = 2000;

export type GestureEvent =
  | { type: 'tap'; x: number; y: number }
  | { type: 'holdStart'; x: number; y: number; progress: number }
  | { type: 'holdProgress'; x: number; y: number; progress: number }
  | { type: 'holdStop' }
  | { type: 'holdComplete'; x: number; y: number }
  | { type: 'cancel' };

interface Press {
  id: number;
  x: number;
  y: number;
  t0: number;
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

  /** The finger being followed, if any. */
  get activeId(): number | null {
    return this.press?.id ?? null;
  }

  down(id: number, x: number, y: number, t: number): GestureEvent[] {
    const out: GestureEvent[] = [];
    if (this.press) {
      if (t - this.press.t0 <= STALE_MS) return [];
      if (!this.press.over) out.push({ type: 'cancel' });
    }
    this.press = { id, x, y, t0: t, ringShown: false, over: false };
    return out;
  }

  move(id: number, x: number, y: number, _t: number): GestureEvent[] {
    const p = this.press;
    if (!p || p.id !== id || p.over) return [];
    if (Math.hypot(x - p.x, y - p.y) > SLOP_PX) {
      p.over = true;
      return [{ type: 'cancel' }];
    }
    return [];
  }

  up(id: number, x: number, y: number, t: number): GestureEvent[] {
    const p = this.press;
    if (!p || p.id !== id) return [];
    this.press = null;
    if (p.over) return [];
    if (t - p.t0 >= HOLD_MS) return [{ type: 'holdComplete', x: p.x, y: p.y }];
    return [{ type: 'tap', x, y }];
  }

  /** pointercancel for that finger; with no id, ends whatever is down. */
  cancel(id?: number): GestureEvent[] {
    const p = this.press;
    if (!p || (id !== undefined && p.id !== id)) return [];
    this.press = null;
    return p.over ? [] : [{ type: 'cancel' }];
  }

  /** Call every frame with whether holding here would dig now. */
  tick(t: number, canDig: boolean): GestureEvent[] {
    const p = this.press;
    if (!p || p.over) return [];
    const held = t - p.t0;
    if (held >= HOLD_MS) {
      p.over = true;
      return [{ type: 'holdComplete', x: p.x, y: p.y }];
    }
    if (!canDig) {
      if (!p.ringShown) return [];
      p.ringShown = false;
      return [{ type: 'holdStop' }];
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
