import type { LineKey } from '../content/lines';
import type { SaveFlags } from '../core/save';

/** The caves' once-hints (7h), saved in `flags.hints` beside the farm's. */
export type CaveHint = 'digDown' | 'gemFound';

export const hasHint = (flags: Pick<SaveFlags, 'hints'>, name: string): boolean => (flags.hints ?? []).includes(name);

/** Adds a hint to the saved list once; every other hint stays (additive, never lowered). */
export function addHint(flags: Pick<SaveFlags, 'hints'>, name: string): void {
  if (hasHint(flags, name)) return;
  flags.hints = [...(flags.hints ?? []), name];
}

/** Keeps every saved hint and adds the farm's (the farm tracker only knows its own five). */
export function mergeHints(saved: readonly string[] | undefined, farm: readonly string[]): string[] {
  return [...(saved ?? []), ...farm.filter(h => !(saved ?? []).includes(h))];
}

/**
 * "Let's dig down and find caves": the second idle hint, once per save, only after the village
 * walk and only while he has never been deep in a real cave.
 */
export function digDownReady(flags: Pick<SaveFlags, 'ledToVillage' | 'cavesSeen' | 'hints'>, idleNumber: number): boolean {
  return idleNumber === 2 && flags.ledToVillage && flags.cavesSeen !== true && !hasHint(flags, 'digDown');
}

/** Once-only hints, saved (`flags.hints`). Each is a plain-word line from Pip. */
export type HintKey = 'plantSome' | 'needWaterSun' | 'cropReady' | 'holdOutFood' | 'tryMunch'
  | 'grumpArrives' | 'plantsWaiting' | 'craftWeapon' | 'pickWeapon' | 'friendMade';
const HINT_KEYS: readonly HintKey[] = [
  'plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch',
  'grumpArrives', 'plantsWaiting', 'craftWeapon', 'pickWeapon', 'friendMade',
];

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
  /** The grumps step (all optional: absent means false or zero). */
  grumpHere?: boolean;
  /** Seconds since the first grump on the farm arrived. */
  grumpWaitedSeconds?: number;
  /** Some plant is paused by a sulky grump. */
  plantsPaused?: boolean;
  hasWeapon?: boolean;
  weaponSelected?: boolean;
  sulkyInView?: boolean;
  friendJustMade?: boolean;
}

/** Pip says the weapon hint this long after a grump arrives, if he still has no weapon. */
export const CRAFT_WEAPON_AFTER_SECONDS = 20;

/** One reaction line per kind this often (the Pal's own 4 s gap still applies on top). */
export const REACTION_GAP_MS = 20_000;

const READY: Record<HintKey, (c: HintContext) => boolean> = {
  plantSome: c => c.hasSeeds && c.nearPlot,
  needWaterSun: c => c.planted,
  cropReady: c => c.ripeNearby,
  holdOutFood: c => c.nearPasture && c.hasFood,
  tryMunch: c => c.edibleSelected,
  grumpArrives: c => c.grumpHere === true,
  plantsWaiting: c => c.plantsPaused === true,
  craftWeapon: c => c.grumpHere === true && c.hasWeapon !== true && (c.grumpWaitedSeconds ?? 0) >= CRAFT_WEAPON_AFTER_SECONDS,
  pickWeapon: c => c.hasWeapon === true && c.sulkyInView === true && c.weaponSelected !== true,
  friendMade: c => c.friendJustMade === true,
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

  /** True when this kind of reaction has not been said in the last 20 s. Changes nothing. */
  reactionReady(key: LineKey, nowMs: number): boolean {
    const last = this.lastReaction.get(key);
    // A clock that went backwards must not lock the reaction out.
    return !(last !== undefined && nowMs >= last && nowMs - last < REACTION_GAP_MS);
  }

  /** Remembers that this kind of reaction was really said now. */
  reactionSaid(key: LineKey, nowMs: number): void {
    this.lastReaction.set(key, nowMs);
  }

  /** Ready, and remembered in one step (for callers that cannot be refused afterwards). */
  reactionAllowed(key: LineKey, nowMs: number): boolean {
    if (!this.reactionReady(key, nowMs)) return false;
    this.reactionSaid(key, nowMs);
    return true;
  }
}
