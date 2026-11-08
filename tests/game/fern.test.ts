import { describe, expect, it } from 'vitest';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { FERN_LINES } from '../../src/content/villagers';
import { fernGift } from '../../src/game/fern';

describe('Fern', () => {
  it('her first hello gives 5/5/5 seeds and 2 saplings, once, and sets the flag', () => {
    const inv = new Inventory();
    const flags: { fernSeeds?: boolean } = {};
    const g = fernGift(flags, inv, { seeds: 0, growing: 0 });
    expect(g?.kind).toBe('seedGift');
    expect(g?.lines).toBe(FERN_LINES.seedGift);
    expect([inv.count(ItemId.WheatSeed), inv.count(ItemId.CarrotSeed), inv.count(ItemId.PotatoSeed), inv.count(ItemId.AppleSapling)]).toEqual([5, 5, 5, 2]);
    expect(flags.fernSeeds).toBe(true);
  });
  it('the starter gift never happens twice, even with an empty bag after a tidy-up', () => {
    const flags = { fernSeeds: true };
    const inv = new Inventory();
    inv.add(ItemId.WheatSeed, 1);
    expect(fernGift(flags, inv, { seeds: 1, growing: 0 })).toBeNull();
    expect(fernGift(flags, inv, { seeds: 0, growing: 2 })).toBeNull();
    expect(inv.count(ItemId.WheatSeed)).toBe(1);
  });
  it('with no seeds and nothing growing she tops up 3 of each, so there is no dead end', () => {
    const inv = new Inventory();
    const g = fernGift({ fernSeeds: true }, inv, { seeds: 0, growing: 0 });
    expect(g?.kind).toBe('moreSeeds');
    expect(g?.lines).toBe(FERN_LINES.moreSeeds);
    expect([inv.count(ItemId.WheatSeed), inv.count(ItemId.CarrotSeed), inv.count(ItemId.PotatoSeed)]).toEqual([3, 3, 3]);
  });
  it('a full stack of seeds never takes anything away', () => {
    const inv = new Inventory();
    inv.add(ItemId.WheatSeed, 98);
    fernGift({}, inv, { seeds: 98, growing: 0 });
    expect(inv.count(ItemId.WheatSeed)).toBe(99);
  });
});
