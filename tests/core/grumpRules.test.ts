import { describe, expect, test } from 'vitest';
import {
  FIRE_COOLDOWN, FLIGHT_SECONDS, FRIEND_CAP, FRIEND_EVERY, HITS_TO_CHEER, WEAPON_REACH, becomesFriend, rewardFor,
} from '../../src/core/grumpRules';
import { Inventory } from '../../src/core/inventory';
import { ITEMS, ItemId, isItemId } from '../../src/core/items';
import { mulberry32 } from '../../src/core/rng';

const SEEDS = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed];
const roll = (seed: number, inv = new Inventory(), opts = { friend: false, atCap: false }) => rewardFor(mulberry32(seed), inv, opts);

describe('grump rules', () => {
  test('constants: reach 8, cooldown 0.5, flight 0.3, hits 2, every 5, cap 5', () => {
    expect([WEAPON_REACH, FIRE_COOLDOWN, FLIGHT_SECONDS, HITS_TO_CHEER, FRIEND_EVERY, FRIEND_CAP]).toEqual([8, 0.5, 0.3, 2, 5, 5]);
  });

  test('roll bands are 60 / 30 / 10 percent over 10,000 seeded rolls (within 3 points)', () => {
    const rng = mulberry32(99);
    let seeds = 0, gems = 0, saplings = 0;
    for (let i = 0; i < 10000; i++) {
      const r = rewardFor(rng, new Inventory(), { friend: false, atCap: false });
      expect(r.length).toBe(1);
      if (SEEDS.includes(r[0].id)) seeds++; else if (r[0].id === ItemId.Gem) gems++; else if (r[0].id === ItemId.AppleSapling) saplings++;
    }
    expect(Math.abs(seeds / 100 - 60)).toBeLessThan(3);
    expect(Math.abs(gems / 100 - 30)).toBeLessThan(3);
    expect(Math.abs(saplings / 100 - 10)).toBeLessThan(3);
  });

  test('seeds are two of one kind and the kind is uniform', () => {
    const rng = mulberry32(5);
    const per = new Map<ItemId, number>();
    for (let i = 0; i < 6000; i++) {
      const r = rewardFor(rng, new Inventory(), { friend: false, atCap: false });
      if (!SEEDS.includes(r[0].id)) continue;
      expect(r[0].n).toBe(2);
      per.set(r[0].id, (per.get(r[0].id) ?? 0) + 1);
    }
    const counts = [...per.values()];
    expect(counts.length).toBe(3);
    const total = counts.reduce((a, b) => a + b, 0);
    for (const c of counts) expect(Math.abs(c / total - 1 / 3)).toBeLessThan(0.04);
  });

  test('a reward that does not fit is skipped and the next fitting one is used', () => {
    for (let s = 0; s < 200; s++) {
      const inv = new Inventory();
      for (const id of SEEDS) inv.add(id, 99);
      const r = roll(s, inv);
      expect(r.length).toBe(1);
      expect([ItemId.Gem, ItemId.AppleSapling]).toContain(r[0].id);
    }
  });

  test('nothing fits gives an empty reward', () => {
    const inv = new Inventory();
    for (const id of [...SEEDS, ItemId.Gem, ItemId.AppleSapling]) inv.add(id, 99);
    for (let s = 0; s < 50; s++) expect(roll(s, inv)).toEqual([]);
  });

  test('a result never takes any stack above 99', () => {
    for (let s = 0; s < 500; s++) {
      const inv = new Inventory();
      for (const id of [...SEEDS, ItemId.Gem, ItemId.AppleSapling]) inv.add(id, 98);
      for (const opts of [{ friend: false, atCap: false }, { friend: true, atCap: false }, { friend: false, atCap: true }]) {
        const tally = new Map<ItemId, number>();
        for (const e of rewardFor(mulberry32(s), inv, opts)) tally.set(e.id, (tally.get(e.id) ?? 0) + e.n);
        for (const [id, n] of tally) expect(inv.count(id) + n).toBeLessThanOrEqual(99);
      }
    }
  });

  test('a friend always gives one Gem if it fits', () => {
    expect(roll(1, new Inventory(), { friend: true, atCap: false })).toEqual([{ id: ItemId.Gem, n: 1 }]);
    const full = new Inventory();
    full.add(ItemId.Gem, 99);
    expect(roll(1, full, { friend: true, atCap: false })).toEqual([]);
  });

  test('at cap gives the roll plus one extra Gem', () => {
    for (let s = 0; s < 100; s++) {
      const r = roll(s, new Inventory(), { friend: false, atCap: true });
      const gems = r.filter(e => e.id === ItemId.Gem).reduce((a, e) => a + e.n, 0);
      expect(gems).toBeGreaterThanOrEqual(1);
      expect(r.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('becomesFriend: true at 5, 10, 15 with fewer than 5 friends, false at 5 friends, false otherwise', () => {
    for (const n of [5, 10, 15]) expect(becomesFriend(n, 4)).toBe(true);
    for (const n of [5, 10, 15]) expect(becomesFriend(n, 5)).toBe(false);
    for (const n of [0, 1, 2, 3, 4, 6, 7, 8, 9, 11]) expect(becomesFriend(n, 0)).toBe(false);
  });

  test('all reward items are registered item ids', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      for (const e of rewardFor(rng, new Inventory(), { friend: i % 3 === 0, atCap: i % 5 === 0 })) {
        expect(isItemId(e.id)).toBe(true);
        expect(ITEMS[e.id]).toBeDefined();
        expect(e.n).toBeGreaterThan(0);
      }
    }
  });
});
