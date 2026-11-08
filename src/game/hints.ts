import type { LineKey } from '../content/lines';

/** Once-only hints, saved (`flags.hints`). Each is a plain-word line from Pip. */
export type HintKey = 'plantSome' | 'needWaterSun' | 'cropReady' | 'holdOutFood' | 'tryMunch';
const HINT_KEYS: readonly HintKey[] = ['plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch'];

/** The facts a hint needs to be true when it is said. */
export interface HintContext {
  hasSeeds: boolean;
  nearPlot: boolean;
  /** At least one plant has been planted. */
  planted: boolean;
  /** A ripe plant is close by. */
  ripeNearby: boolean;
  hasFood: boolean;
  nearPasture: boolean;
  edibleSelected: boolean;
}

/** One reaction line per kind this often (the Pal's own 4 s gap still applies on top). */
export const REACTION_GAP_MS = 20_000;

const READY: Record<HintKey, (c: HintContext) => boolean> = {
  plantSome: c => c.hasSeeds && c.nearPlot,
  needWaterSun: c => c.planted,
  cropReady: c => c.ripeNearby,
  holdOutFood: c => c.nearPasture && c.hasFood,
  tryMunch: c => c.edibleSelected,
};

export class FarmHints {
  private readonly done = new Set<HintKey>();
  private readonly lastReaction = new Map<string, number>();

  constructor(seen: readonly string[]) {
    for (const k of seen) if ((HINT_KEYS as readonly unknown[]).includes(k)) this.done.add(k as HintKey);
  }

  shouldSay(key: HintKey, ctx: HintContext): boolean {
    return !this.done.has(key) && READY[key](ctx);
  }

  markSeen(key: HintKey): void {
    this.done.add(key);
  }

  seen(): string[] {
    return HINT_KEYS.filter(k => this.done.has(k));
  }

  /** True (and remembers it) when this kind of reaction has not been said in the last 20 s. */
  reactionAllowed(key: LineKey, nowMs: number): boolean {
    const last = this.lastReaction.get(key);
    // A clock that went backwards must not lock the reaction out.
    if (last !== undefined && nowMs >= last && nowMs - last < REACTION_GAP_MS) return false;
    this.lastReaction.set(key, nowMs);
    return true;
  }
}
