import { MAX_STACK, type Inventory } from './inventory';
import { ItemId } from './items';

/** Pure grump rules: constants, the reward roll and the friend rule. */
export const HITS_TO_CHEER = 2;
export const FRIEND_EVERY = 5;
export const FRIEND_CAP = 5;
export const WEAPON_REACH = 8;
export const FIRE_COOLDOWN = 0.5;
export const FLIGHT_SECONDS = 0.3;

const SEED_KINDS: readonly ItemId[] = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed];

export interface RewardEntry { id: ItemId; n: number }

/**
 * The small gift for cheering a grump up. One roll: 60% two seeds (one kind, equal chance), 30% a
 * gem, 10% an apple sapling. Only entries that fit under 99 are given, whole and never partial: one
 * that does not fit is skipped and the next fitting one used, and if none fits there is no reward.
 * A new friend always brings one gem; a cheer-up at the friend cap adds one extra gem.
 */
export function rewardFor(rng: () => number, inv: Inventory, opts: { friend: boolean; atCap: boolean }): RewardEntry[] {
  const given = new Map<ItemId, number>();
  const fits = (e: RewardEntry): boolean => inv.count(e.id) + (given.get(e.id) ?? 0) + e.n <= MAX_STACK;
  const give = (e: RewardEntry): boolean => {
    if (!fits(e)) return false;
    given.set(e.id, (given.get(e.id) ?? 0) + e.n);
    return true;
  };
  const gem: RewardEntry = { id: ItemId.Gem, n: 1 };
  if (opts.friend) {
    give(gem);
  } else {
    const r = rng();
    const kind = Math.min(SEED_KINDS.length - 1, Math.floor(rng() * SEED_KINDS.length));
    const seeds = (k: number): RewardEntry => ({ id: SEED_KINDS[k % SEED_KINDS.length], n: 2 });
    const sapling: RewardEntry = { id: ItemId.AppleSapling, n: 1 };
    // The rolled gift first, then the others in a fixed order.
    const order: RewardEntry[] = r < 0.6
      ? [seeds(kind), seeds(kind + 1), seeds(kind + 2), gem, sapling]
      : r < 0.9 ? [gem, seeds(kind), seeds(kind + 1), seeds(kind + 2), sapling]
        : [sapling, gem, seeds(kind), seeds(kind + 1), seeds(kind + 2)];
    for (const e of order) if (give(e)) break;
    if (opts.atCap) give(gem);
  }
  return [...given].map(([id, n]) => ({ id, n }));
}

/** The 5th, 10th, 15th... cheer-up becomes a friend, while fewer than FRIEND_CAP friends exist. */
export const becomesFriend = (cheeredAfter: number, friendCount: number): boolean =>
  cheeredAfter > 0 && cheeredAfter % FRIEND_EVERY === 0 && friendCount < FRIEND_CAP;
