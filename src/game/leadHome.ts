import type { Cell } from '../core/pathfind';
import { LEAD_CATCH_UP_SPEED, LEAD_GAP_MAX, LEAD_GAP_MIN, LEAD_SPEED } from './lead';

/** Seconds of quiet deep underground before Pip offers to lead him up. */
export const LEAD_HOME_QUIET = 25;
/** Seconds without him following before Pip politely stops leading (and does not ask again this trip). */
export const LEAD_HOME_GIVE_UP = 60;
/** He is "on the way" when within this many blocks of the route. */
const ON_ROUTE = 6;

export type LeadHomeState = 'idle' | 'offered' | 'leading' | 'arrived' | 'ignored';
export type LeadHomeEvent = 'offer' | 'giveUp' | 'arrive';

/**
 * Pip leads him home on foot (spec 7h, plan Task 21). A pure state machine: it never moves him,
 * turns him or touches the camera; it only says when to offer, how far along the way home Pip
 * should be, and when he has arrived or Pip has given up. Time stands still while paused.
 *
 * idle -> (deep and quiet for 25 s, or a tap he cannot walk to) offered -> begin(route) leading ->
 * at the mouth, or no longer deep: arrived; no progress for 60 s: ignored. Arrived and ignored
 * stay so while he is deep: Pip asks once per trip. Everything resets when he is no longer deep.
 */
export class LeadHome {
  state: LeadHomeState = 'idle';
  private readonly quietSeconds: number;
  private readonly giveUpSeconds: number;
  private quiet = 0;
  private route: readonly Cell[] = [];
  /** Fractional index along the route that Pip is heading for. */
  private lead = 0;
  private playerIdx = -1;
  private bestIdx = -1;
  private noProgress = 0;

  constructor(opts: { quietSeconds?: number; giveUpSeconds?: number } = {}) {
    this.quietSeconds = opts.quietSeconds ?? LEAD_HOME_QUIET;
    this.giveUpSeconds = opts.giveUpSeconds ?? LEAD_HOME_GIVE_UP;
  }

  /**
   * One frame. `active`: he did something this frame (a tap, a dig, the stick). `atMouth`: he
   * stands at the end of the way home. `playerCell` is needed while leading.
   */
  update(dt: number, deep: boolean, active: boolean, paused: boolean, atMouth: boolean, playerCell?: Cell): LeadHomeEvent | null {
    if (paused || !(dt > 0)) return null;
    if (this.state === 'leading' && (atMouth || !deep)) {
      this.state = 'arrived';
      return 'arrive';
    }
    if (!deep) {
      this.reset();
      return null;
    }
    if (this.state === 'idle') {
      this.quiet = active ? 0 : this.quiet + dt;
      if (this.quiet < this.quietSeconds) return null;
      this.state = 'offered';
      return 'offer';
    }
    if (this.state !== 'leading' || !playerCell) return null;
    return this.updateLeading(dt, playerCell);
  }

  /** A tap he could not walk to while deep: offer at once (only from idle, so once per trip). */
  offerNow(): boolean {
    if (this.state !== 'idle') return false;
    this.state = 'offered';
    return true;
  }

  /** Pip starts walking the way home (the caller has found it). */
  begin(route: readonly Cell[], playerCell: Cell): void {
    if (this.state !== 'offered' || route.length < 2) { this.decline(); return; }
    this.state = 'leading';
    this.route = route;
    this.playerIdx = this.nearestIndex(playerCell, true);
    this.bestIdx = this.playerIdx;
    this.noProgress = 0;
    this.lead = Math.min(route.length - 1, this.playerIdx + LEAD_GAP_MIN);
  }

  /** No way home was found, or someone else is leading: no offer this trip. */
  decline(): void {
    if (this.state === 'offered' || this.state === 'leading') this.state = 'ignored';
  }

  /** Back to the start (he is on the surface again, or the Home button lifted him). */
  reset(): void {
    this.state = 'idle';
    this.quiet = 0;
    this.route = [];
    this.playerIdx = -1;
    this.bestIdx = -1;
    this.noProgress = 0;
    this.lead = 0;
  }

  /** The route index Pip should be heading for now, or -1 when not leading. */
  targetIndex(): number {
    return this.state === 'leading' ? Math.floor(this.lead) : -1;
  }

  private updateLeading(dt: number, playerCell: Cell): LeadHomeEvent | null {
    this.playerIdx = this.nearestIndex(playerCell, false);
    if (this.playerIdx > this.bestIdx) { this.bestIdx = this.playerIdx; this.noProgress = 0; }
    else this.noProgress += dt;
    if (this.noProgress >= this.giveUpSeconds) {
      this.state = 'ignored';
      return 'giveUp';
    }
    const gap = this.lead - this.playerIdx;
    if (gap >= LEAD_GAP_MAX) return null; // Pip waits for him to catch up
    const speed = gap < 1 ? LEAD_CATCH_UP_SPEED : LEAD_SPEED;
    this.lead = Math.min(this.route.length - 1, this.lead + speed * dt);
    return null;
  }

  /** Route index nearest to him: near the last one first, so a route that doubles back cannot jump. */
  private nearestIndex(c: Cell, anywhere: boolean): number {
    const search = (from: number, to: number): { i: number; d: number } => {
      let i = -1, d = Infinity;
      for (let k = from; k <= to; k++) {
        const r = this.route[k];
        const dk = Math.hypot(r[0] - c[0], r[2] - c[2]) + Math.abs(r[1] - c[1]) * 0.5;
        if (dk < d) { d = dk; i = k; }
      }
      return { i, d };
    };
    if (anywhere || this.playerIdx < 0) return search(0, this.route.length - 1).i;
    const near = search(Math.max(0, this.playerIdx - 15), Math.min(this.route.length - 1, this.playerIdx + 30));
    if (near.d <= ON_ROUTE) return near.i;
    const far = search(0, this.route.length - 1);
    return far.d <= ON_ROUTE ? far.i : this.playerIdx;
  }
}
