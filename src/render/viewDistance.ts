/**
 * How far he can see: the fog end in blocks, between VIEW_MIN (today's 40) and VIEW_MAX (96), adjusted
 * to the tablet's speed (Task 10b). Pure: no DOM, no three.js; the clock (milliseconds) is injected.
 *
 * Auto starts at 40 (known safe) and grows 8 at a time while frames are fast, never faster than one
 * step per 5 s and only with the section build queue empty and the draw budgets clear; it shrinks 8 at
 * once after 1.5 s of slow frames (or over budget). Between the two thresholds nothing changes, a
 * distance it had to leave is not tried again for 2 minutes, and a stall frame (tab hidden, garbage
 * collection, loading) is dropped and starts a short settle. Near, Medium and Far pin a distance.
 */
export const VIEW_MIN = 40;
export const VIEW_MAX = 96;
export const VIEW_START = 40;
export const VIEW_STEP = 8;

export type ViewSetting = 'auto' | 'near' | 'medium' | 'far';
export const VIEW_SETTINGS: readonly ViewSetting[] = ['auto', 'near', 'medium', 'far'];
export const SETTING_VIEW = { near: 40, medium: 64, far: 96 } as const;

export interface ViewTuning {
  /** Shrink when the frame-time average is above this (ms) for shrinkAfterS. */
  shrinkMs: number;
  /** Grow when it is below this (ms) for growAfterS. */
  growMs: number;
  shrinkAfterS: number;
  growAfterS: number;
  /** No growth this long after a shrink. */
  coolOffS: number;
  /** After a shrink from d, nothing above d - 8 for this long. */
  ceilingS: number;
  /** Each sample is capped at this before it enters the average. */
  sampleCapMs: number;
  /** A frame longer than this is a stall: dropped, and a settle starts. */
  stallMs: number;
  /**
   * The draw budgets (whole-page draw calls, frustum-visible sections): growth needs 10 percent headroom
   * under them; going over them for shrinkAfterS shrinks even with fast frames.
   */
  growMaxDrawCalls: number;
  growMaxSections: number;
  shrinkDrawCalls: number;
  shrinkSections: number;
}

/** Every number the tablet check may retune, in one place. */
export const DEFAULT_TUNING: ViewTuning = {
  shrinkMs: 34, growMs: 26, shrinkAfterS: 1.5, growAfterS: 5, coolOffS: 30, ceilingS: 120, sampleCapMs: 60, stallMs: 250,
  growMaxDrawCalls: 100, growMaxSections: 64, shrinkDrawCalls: 110, shrinkSections: 70,
};
/** After a shrink or a stall no decision is made for this long. */
const SETTLE_MS = 2000;
/** The average's time constant, and the value it restarts at (in the do-nothing band). */
const EMA_TAU_MS = 1000;
const EMA_RESET_MS = 30;

export interface FrameContext {
  /** Sections still waiting for their first build. */
  backlog?: number;
  drawCalls?: number;
  /** Visible sections (frustum). */
  sections?: number;
}

export class ViewDistance {
  private d: number;
  private ema = EMA_RESET_MS;
  private setting: ViewSetting = 'auto';
  private overSince: number | null = null;
  private underSince: number | null = null;
  private lastShrink = -Infinity;
  private lastGrow = -Infinity;
  private settleUntil = -Infinity;
  private pausedUntil = -Infinity;
  private ceiling: { limit: number; until: number } | null = null;

  constructor(
    private readonly now: () => number,
    private readonly tuning: ViewTuning = DEFAULT_TUNING,
    start: number = VIEW_START,
  ) {
    this.d = ViewDistance.snap(start);
  }

  /** Within VIEW_MIN..VIEW_MAX, on the 8-block grid from 40. */
  private static snap(v: number): number {
    if (!Number.isFinite(v)) return VIEW_START;
    const c = Math.max(VIEW_MIN, Math.min(VIEW_MAX, v));
    return VIEW_MIN + Math.round((c - VIEW_MIN) / VIEW_STEP) * VIEW_STEP;
  }

  /** The fog end in blocks, always within VIEW_MIN..VIEW_MAX. */
  get distance(): number {
    return this.d;
  }

  get emaMs(): number {
    return this.ema;
  }

  get pinned(): boolean {
    return this.setting !== 'auto';
  }

  get currentSetting(): ViewSetting {
    return this.setting;
  }

  /** Near, Medium and Far pin their distance at once; Auto resumes from the current distance with a fresh average. */
  setSetting(s: ViewSetting): void {
    if (!VIEW_SETTINGS.includes(s)) s = 'auto';
    this.setting = s;
    if (s !== 'auto') {
      this.d = SETTING_VIEW[s];
      return;
    }
    this.ema = EMA_RESET_MS;
    this.overSince = null;
    this.underSince = null;
    this.ceiling = null;
    this.settleUntil = this.now() + SETTLE_MS;
  }

  /** Ignore samples for this long (loading, the Home lift, the tab coming back). */
  pause(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + seconds * 1000);
    this.overSince = null;
    this.underSince = null;
  }

  /** Once per rendered frame: the real time since the last one, and the frame's budget numbers. */
  frame(frameMs: number, ctx: FrameContext = {}): void {
    const t = this.now();
    if (t < this.pausedUntil) return;
    const tu = this.tuning;
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    if (frameMs > tu.stallMs) {
      // One stall frame (or a run of them) never moves the view: dropped, then a settle.
      this.settleUntil = t + SETTLE_MS;
      this.overSince = null;
      this.underSince = null;
      return;
    }
    const sample = Math.min(frameMs, tu.sampleCapMs);
    const alpha = 1 - Math.exp(-sample / EMA_TAU_MS);
    this.ema += alpha * (sample - this.ema);
    if (this.pinned) return; // the controller only watches
    if (t < this.settleUntil) {
      this.overSince = null;
      this.underSince = null;
      return;
    }
    const sections = ctx.sections ?? 0;
    const drawCalls = ctx.drawCalls ?? 0;
    const over = this.ema > tu.shrinkMs || sections > tu.shrinkSections || drawCalls > tu.shrinkDrawCalls;
    this.overSince = over ? (this.overSince ?? t) : null;
    if (over && t - this.overSince! >= tu.shrinkAfterS * 1000) {
      this.shrink(t);
      return;
    }
    const under = this.ema < tu.growMs;
    this.underSince = under ? (this.underSince ?? t) : null;
    if (!under || t - this.underSince! < tu.growAfterS * 1000) return;
    if ((ctx.backlog ?? 0) > 0 || drawCalls > tu.growMaxDrawCalls || sections > tu.growMaxSections) return;
    if (t - this.lastShrink < tu.coolOffS * 1000 || t - this.lastGrow < tu.growAfterS * 1000) return;
    if (this.ceiling && t >= this.ceiling.until) this.ceiling = null;
    const next = Math.min(VIEW_MAX, this.d + VIEW_STEP);
    if (next === this.d || (this.ceiling && next > this.ceiling.limit)) return;
    this.d = next;
    this.lastGrow = t;
    this.underSince = t; // judge the new distance on fresh fast frames
  }

  private shrink(t: number): void {
    this.overSince = null;
    this.underSince = null;
    if (this.d <= VIEW_MIN) return; // never below 40: nothing to do but keep watching
    const from = this.d;
    this.d = Math.max(VIEW_MIN, from - VIEW_STEP);
    this.ceiling = { limit: from - VIEW_STEP, until: t + this.tuning.ceilingS * 1000 };
    this.lastShrink = t;
    this.ema = EMA_RESET_MS;
    this.settleUntil = t + SETTLE_MS;
  }
}

/** The fog for a view distance: far = distance, near = half of it (today: 20 and 40). */
export function viewFog(distance: number): { near: number; far: number } {
  const far = Number.isFinite(distance) ? Math.max(VIEW_MIN, Math.min(VIEW_MAX, distance)) : VIEW_MIN;
  return { near: Math.round(far / 2), far };
}
