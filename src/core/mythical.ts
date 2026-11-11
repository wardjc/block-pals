import { BlockId } from './blocks';

/** The wizard's eight mythical blocks, in their fixed order (gift cards, rewards, ties). */
export const MYTHICAL = [
  BlockId.StarlightCrystal,
  BlockId.RainbowBlock,
  BlockId.CloudBlock,
  BlockId.MoonBlock,
  BlockId.SunBlock,
  BlockId.DragonScaleBlock,
  BlockId.StarBlock,
  BlockId.MagicMirror,
] as const;

export type MythicalId = (typeof MYTHICAL)[number];

/** Blocks he gets for each gem price paid. */
export const BUNDLE = 4;

/** Gems per bundle: 1 for Cloud, Rainbow, Sun and Moon; 2 for the other four. */
export const PRICE: Record<MythicalId, 1 | 2> = {
  [BlockId.StarlightCrystal]: 2,
  [BlockId.RainbowBlock]: 1,
  [BlockId.CloudBlock]: 1,
  [BlockId.MoonBlock]: 1,
  [BlockId.SunBlock]: 1,
  [BlockId.DragonScaleBlock]: 2,
  [BlockId.StarBlock]: 2,
  [BlockId.MagicMirror]: 2,
};

const SET: ReadonlySet<number> = new Set(MYTHICAL);

export const isMythical = (id: number): id is MythicalId => Number.isInteger(id) && SET.has(id);

/**
 * The kind a puzzle gives: the one he holds fewest of (ties in MYTHICAL order), skipping stacks
 * already at the cap. null when every stack is full (he still gets the cheer, never a refusal).
 */
export function rewardKind(held: (id: BlockId) => number, cap = 99): MythicalId | null {
  let best: MythicalId | null = null;
  let fewest = Infinity;
  for (const id of MYTHICAL) {
    const n = held(id);
    if (!(n < cap)) continue;
    if (n < fewest) {
      fewest = n;
      best = id;
    }
  }
  return best;
}
