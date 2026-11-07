import type { Cell } from '../core/pathfind';
import { VILLAGE_PLAN, type Rect } from '../core/village';

export const LEAD_SPEED = 3; // blocks/s; the player walks at 3.5
/** Catching up after he overtakes Pip (Pip's follow speed). */
export const LEAD_CATCH_UP_SPEED = 4.5;
export const LEAD_GAP_MIN = 3;
export const LEAD_GAP_MAX = 8; // Pip stays this far ahead along the route, at most
export const LEAD_OFFER_AFTER_ACTION = 8; // seconds
export const LEAD_OFFER_AFTER_LOAD = 25;
export const LEAD_COME_ON_AFTER = 6; // seconds of waiting
export const LEAD_THIS_WAY_AFTER = 15;
export const LEAD_GIVE_UP = 90; // seconds with no progress along the route
/** He is "on the route" when within this many blocks of it. */
const ON_ROUTE = 6;

export type LeadState = 'waiting' | 'leading' | 'arrived' | 'gaveUp' | 'done';
export type LeadEvent = 'start' | 'comeOn' | 'thisWay' | 'arrive' | 'giveUp';

const inRect = (r: Rect, [x, , z]: Cell): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * Pip leads him along the route to the village, once, until he has reached it (the caller saves
 * that). Pure state machine: it holds no reference to the player, never moves him, and only
 * returns events plus where Pip should be heading. Time stands still while `paused`.
 */
export class LeadToVillage {
  state: LeadState;
  private sinceLoad = 0;
  private sinceAction: number | null = null;
  /** Fractional index along the route that Pip is heading for. */
  private lead = 0;
  private playerIdx = -1;
  private bestIdx = -1;
  private noProgress = 0;
  private waited = 0;
  private saidComeOn = false;
  private saidThisWay = false;
  private flagPending = false;

  constructor(
    private readonly route: Cell[],
    private readonly square: Rect,
    flagSet: boolean,
    private readonly pad: Rect = VILLAGE_PLAN.pad,
  ) {
    this.state = flagSet || route.length < 2 ? 'done' : 'waiting';
  }

  update(dt: number, playerCell: Cell, active: boolean, paused: boolean): LeadEvent | null {
    if (paused || !(dt > 0)) return null;
    if (this.state === 'waiting') return this.updateWaiting(dt, playerCell, active);
    if (this.state !== 'leading') return null;
    return this.updateLeading(dt, playerCell);
  }

  private updateWaiting(dt: number, playerCell: Cell, active: boolean): LeadEvent | null {
    this.sinceLoad += dt;
    if (this.sinceAction !== null) this.sinceAction += dt;
    else if (active) this.sinceAction = 0;
    if (inRect(this.pad, playerCell)) { // already in the village: nothing to lead
      this.state = 'arrived';
      this.flagPending = true;
      return null;
    }
    if (this.sinceLoad < LEAD_OFFER_AFTER_LOAD && !(this.sinceAction !== null && this.sinceAction >= LEAD_OFFER_AFTER_ACTION)) return null;
    this.state = 'leading';
    this.playerIdx = this.nearestIndex(playerCell, true);
    this.bestIdx = this.playerIdx;
    this.lead = Math.min(this.route.length - 1, this.playerIdx + LEAD_GAP_MIN);
    return 'start';
  }

  private updateLeading(dt: number, playerCell: Cell): LeadEvent | null {
    this.playerIdx = this.nearestIndex(playerCell, false);
    if (this.playerIdx > this.bestIdx) { this.bestIdx = this.playerIdx; this.noProgress = 0; }
    else this.noProgress += dt;

    const last = this.route[this.route.length - 1];
    const nearEnd = this.lead >= this.route.length - 1.5
      && Math.hypot(playerCell[0] - last[0], playerCell[2] - last[2]) <= 8;
    if (inRect(this.square, playerCell) || nearEnd) {
      this.state = 'arrived';
      this.flagPending = true;
      return 'arrive';
    }
    if (this.noProgress >= LEAD_GIVE_UP) {
      this.state = 'gaveUp';
      return 'giveUp';
    }

    const gap = this.lead - this.playerIdx;
    if (gap >= LEAD_GAP_MAX) {
      this.waited += dt;
      if (!this.saidComeOn && this.waited >= LEAD_COME_ON_AFTER) { this.saidComeOn = true; return 'comeOn'; }
      if (!this.saidThisWay && this.waited >= LEAD_THIS_WAY_AFTER) { this.saidThisWay = true; return 'thisWay'; }
      return null;
    }
    this.waited = 0;
    this.saidComeOn = false;
    this.saidThisWay = false;
    // Overtaken (or nearly): catch up at follow speed instead of blocking him.
    const speed = gap < 1 ? LEAD_CATCH_UP_SPEED : LEAD_SPEED;
    this.lead = Math.min(this.route.length - 1, this.lead + speed * dt);
    return null;
  }

  /** Route index nearest to the player: near the last one first, so a route that doubles back cannot jump. */
  private nearestIndex(c: Cell, anywhere: boolean): number {
    const search = (from: number, to: number): { i: number; d: number } => {
      let i = -1;
      let d = Infinity;
      for (let k = from; k <= to; k++) {
        const dk = Math.hypot(this.route[k][0] - c[0], this.route[k][2] - c[2]);
        if (dk < d) { d = dk; i = k; }
      }
      return { i, d };
    };
    const all = (): { i: number; d: number } => search(0, this.route.length - 1);
    if (anywhere || this.playerIdx < 0) return all().i;
    const near = search(Math.max(0, this.playerIdx - 15), Math.min(this.route.length - 1, this.playerIdx + 30));
    if (near.d <= ON_ROUTE) return near.i;
    // Far from where he was: he may have been carried elsewhere on the route (a teleport); otherwise he
    // wandered off, so keep the last known place and Pip waits for him.
    const far = all();
    return far.d <= ON_ROUTE ? far.i : this.playerIdx;
  }

  /** The route index Pip should be heading for now, or -1 when not leading. */
  targetIndex(): number {
    return this.state === 'leading' ? Math.floor(this.lead) : -1;
  }

  /** Where Pip should be heading now (or null when not leading). */
  target(): Cell | null {
    return this.state === 'leading' ? this.route[Math.floor(this.lead)] : null;
  }

  /** True once, when state becomes 'arrived'. */
  takeFlagSet(): boolean {
    const f = this.flagPending;
    this.flagPending = false;
    return f;
  }
}
