import { FERN_LINES } from '../content/villagers';
import type { Inventory } from '../core/inventory';
import { ItemId } from '../core/items';

/** Her first hello, once per save: 5 of each crop seed and 2 apple saplings. */
export const STARTER_SEEDS: ReadonlyArray<[ItemId, number]> = [
  [ItemId.WheatSeed, 5], [ItemId.CarrotSeed, 5], [ItemId.PotatoSeed, 5], [ItemId.AppleSapling, 2],
];
/** Later, only if he has no seeds at all and nothing growing: 3 of each crop seed. */
export const TOP_UP_SEEDS: ReadonlyArray<[ItemId, number]> = [
  [ItemId.WheatSeed, 3], [ItemId.CarrotSeed, 3], [ItemId.PotatoSeed, 3],
];

export type FernGift = { kind: 'seedGift' | 'moreSeeds'; lines: string[] };

/**
 * What Fern gives on this hello, if anything. The first hello of a save gives the starter seeds (the
 * flag is set here, so the caller saves at once); after that she tops up an empty bag with nothing
 * growing, so there is never a dead end. Otherwise null and she says her ordinary hello.
 */
export function fernGift(
  flags: { fernSeeds?: boolean }, inv: Inventory, state: { seeds: number; growing: number },
): FernGift | null {
  if (flags.fernSeeds !== true) {
    for (const [id, n] of STARTER_SEEDS) inv.add(id, n);
    flags.fernSeeds = true;
    return { kind: 'seedGift', lines: FERN_LINES.seedGift };
  }
  if (state.seeds === 0 && state.growing === 0) {
    for (const [id, n] of TOP_UP_SEEDS) inv.add(id, n);
    return { kind: 'moreSeeds', lines: FERN_LINES.moreSeeds };
  }
  return null;
}
