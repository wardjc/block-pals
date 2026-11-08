/** Real-time growth rules. Pure: nothing here knows about blocks, the DOM or the wall clock. */

/** Crops: time for each stage (sprout, growing, big, then ripe). */
export const STAGE_MS = 150_000;
/** Apple trees: sapling to young, young to full, full to ripe. */
export const TREE_STAGE_MS = [180_000, 240_000, 180_000];
/** After apples are picked the tree ripens again. */
export const APPLE_REGROW_MS = 180_000;
/** Plants grow for at most this long while the game was closed or the tab slept. */
export const OFFLINE_CAP_MS = 8 * 3600_000;

/**
 * One rule for time passing, whatever the wall clock does. Each step adds `now - last` clamped to
 * 0 .. OFFLINE_CAP_MS and moves `last` on. A clock that went backwards, NaN or Infinity adds
 * nothing (and never punishes: the next normal step carries on from the new `last`).
 */
export class GrowthClock {
  private last: number;

  constructor(last: number) {
    this.last = Number.isFinite(last) ? last : NaN;
  }

  /** Milliseconds to add to every growth timer now. */
  step(now: number): number {
    if (!Number.isFinite(now)) return 0;
    const add = Number.isFinite(this.last) ? Math.min(Math.max(0, now - this.last), OFFLINE_CAP_MS) : 0;
    this.last = now;
    return add;
  }
}

/**
 * Adds time to a growing thing. `stageMs` is the length of every stage, or one length per stage.
 * The stage only ever goes up; at `max` (ripe) no leftover is kept. Bad amounts add nothing.
 */
export function advanceStage(
  stage: number, progress: number, add: number, stageMs: number[] | number, max: number,
): { stage: number; progress: number } {
  if (stage >= max) return { stage: Math.max(stage, max), progress: 0 };
  let p = Math.max(0, Number.isFinite(progress) ? progress : 0);
  let s = stage;
  let left = Number.isNaN(add) ? 0 : Math.max(0, add);
  const lengthOf = (i: number): number => (typeof stageMs === 'number' ? stageMs : stageMs[Math.min(i, stageMs.length - 1)]);
  while (s < max) {
    const need = lengthOf(s) - p;
    if (left < need) return { stage: s, progress: p + left };
    left -= need;
    p = 0;
    s++;
  }
  return { stage: max, progress: 0 };
}
