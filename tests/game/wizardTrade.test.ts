import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory, MAX_STACK } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { mulberry32 } from '../../src/core/rng';
import {
  WIZARD_STOCK, buy, canBuy, claimGift, newWizardState, puzzleReward, recordSolve, rewardKind,
  type Bag, type WizardStock,
} from '../../src/game/wizardTrade';

/** A plain bag that holds any id, like Inventory but without its registry check (the mythical ids land in a separate change). */
class FakeBag implements Bag {
  readonly counts = new Map<number, number>();
  constructor(init: Record<number, number> = {}) {
    for (const [k, v] of Object.entries(init)) this.counts.set(Number(k), v);
  }
  count(id: number): number { return this.counts.get(id) ?? 0; }
  add(id: number, n = 1): number {
    const added = Math.max(0, Math.min(n, MAX_STACK - this.count(id)));
    if (added > 0) this.counts.set(id, this.count(id) + added);
    return added;
  }
  remove(id: number, n = 1): boolean {
    if (this.count(id) < n) return false;
    this.counts.set(id, this.count(id) - n);
    return true;
  }
  snapshot(): string { return JSON.stringify([...this.counts].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0])); }
}

const S = WIZARD_STOCK;
const GEM = S.gem;
const [STARLIGHT, RAINBOW, CLOUD, MOON, SUN, DRAGON, STAR, MIRROR] = S.order as [number, number, number, number, number, number, number, number];

describe('the wizard stock (provisional until the mythical blocks land)', () => {
  it('eight kinds in the fixed order with the planned prices and a bundle of 4', () => {
    expect(S.order).toHaveLength(8);
    expect(new Set(S.order).size).toBe(8);
    expect(S.bundle).toBe(4);
    for (const id of [RAINBOW, CLOUD, MOON, SUN]) expect(S.price[id]).toBe(1);
    for (const id of [STARLIGHT, DRAGON, STAR, MIRROR]) expect(S.price[id]).toBe(2);
    for (const id of S.order) expect(S.price[id]! * S.bundle).toBeLessThanOrEqual(20);
  });
});

describe('buy', () => {
  it('takes PRICE gems and gives BUNDLE blocks', () => {
    const bag = new FakeBag({ [GEM]: 3 });
    expect(canBuy(bag, CLOUD)).toEqual({ ok: true, got: 4, spent: 1 });
    expect(buy(bag, CLOUD)).toEqual({ ok: true, got: 4, spent: 1 });
    expect(bag.count(GEM)).toBe(2);
    expect(bag.count(CLOUD)).toBe(4);
    expect(buy(bag, STAR)).toEqual({ ok: true, got: 4, spent: 2 });
    expect(bag.count(GEM)).toBe(0);
    expect(bag.count(STAR)).toBe(4);
  });

  it('counts a purchase in wizard.bought when given the state', () => {
    const w = newWizardState();
    buy(new FakeBag({ [GEM]: 1 }), SUN, w);
    expect(w.bought).toBe(1);
    buy(new FakeBag({}), SUN, w);
    expect(w.bought).toBe(1);
  });

  it('not enough gems changes nothing', () => {
    const bag = new FakeBag({ [GEM]: 1, [MOON]: 2 });
    const before = bag.snapshot();
    expect(canBuy(bag, DRAGON)).toEqual({ ok: false, why: 'needGem' });
    expect(buy(bag, DRAGON)).toEqual({ ok: false, why: 'needGem' });
    expect(bag.snapshot()).toBe(before);
    expect(buy(new FakeBag(), CLOUD)).toEqual({ ok: false, why: 'needGem' });
  });

  it('a stack that would pass 99 changes nothing and no gem is spent', () => {
    const bag = new FakeBag({ [GEM]: 5, [CLOUD]: 96 });
    const before = bag.snapshot();
    expect(buy(bag, CLOUD)).toEqual({ ok: false, why: 'bagFull' });
    expect(bag.snapshot()).toBe(before);
    bag.counts.set(CLOUD, 95);
    expect(buy(bag, CLOUD).ok).toBe(true);
    expect(bag.count(CLOUD)).toBe(99);
    expect(bag.count(GEM)).toBe(4);
  });

  it('an unknown or non-mythical id changes nothing', () => {
    const bag = new FakeBag({ [GEM]: 9 });
    const before = bag.snapshot();
    for (const id of [BlockId.Planks, BlockId.Lamp, 35, 48, GEM, -1, 40.5, Number.NaN]) {
      expect(buy(bag, id)).toEqual({ ok: false, why: 'unknown' });
      expect(claimGift(bag, id, newWizardState())).toEqual({ ok: false, why: 'unknown' });
    }
    expect(bag.snapshot()).toBe(before);
  });

  it('a bag that refuses the blocks gets its gems back (all or nothing)', () => {
    const stingy: Bag = {
      counts: new Map<number, number>([[GEM, 2]]),
      count(id) { return this.counts.get(id) ?? 0; },
      add(id, n = 1) { if (id === GEM) { this.counts.set(id, this.count(id) + n); return n; } return 0; },
      remove(id, n = 1) { if (this.count(id) < n) return false; this.counts.set(id, this.count(id) - n); return true; },
    } as Bag & { counts: Map<number, number> };
    expect(buy(stingy, CLOUD)).toEqual({ ok: false, why: 'bagFull' });
    expect(stingy.count(GEM)).toBe(2);
    expect(stingy.count(CLOUD)).toBe(0);
  });
});

describe('the welcome gift', () => {
  it('gives exactly 1 block, once, and sets the flag only on success', () => {
    const bag = new FakeBag();
    const w = newWizardState();
    expect(claimGift(bag, MIRROR, w)).toEqual({ ok: true, got: 1, spent: 0 });
    expect(bag.count(MIRROR)).toBe(1);
    expect(w.gift).toBe(true);
    const before = bag.snapshot();
    expect(claimGift(bag, CLOUD, w)).toEqual({ ok: false, why: 'given' });
    expect(bag.snapshot()).toBe(before);
  });

  it('a full stack keeps the gift for later', () => {
    const bag = new FakeBag({ [SUN]: 99 });
    const w = newWizardState();
    expect(claimGift(bag, SUN, w)).toEqual({ ok: false, why: 'bagFull' });
    expect(w.gift).toBe(false);
    expect(claimGift(bag, MOON, w).ok).toBe(true);
    expect(w.gift).toBe(true);
  });
});

describe('puzzle rewards', () => {
  it('rewardKind picks the fewest held, ties in order, skips full stacks, null when all are full', () => {
    expect(rewardKind(() => 0)).toBe(STARLIGHT);
    const held: Record<number, number> = { [STARLIGHT]: 3, [RAINBOW]: 1, [CLOUD]: 1, [MOON]: 2, [SUN]: 5, [DRAGON]: 4, [STAR]: 2, [MIRROR]: 9 };
    expect(rewardKind(id => held[id] ?? 0)).toBe(RAINBOW);
    expect(rewardKind(id => (id === STARLIGHT ? 99 : 99 - 1))).toBe(RAINBOW);
    expect(rewardKind(() => 99)).toBeNull();
    expect(rewardKind(id => (id === MIRROR ? 98 : 99))).toBe(MIRROR);
  });

  it('puzzleReward gives 1 of the kind he has fewest of and skips full stacks', () => {
    const bag = new FakeBag({ [STARLIGHT]: 99, [RAINBOW]: 2 });
    expect(puzzleReward(bag)).toEqual({ kind: CLOUD, n: 1 });
    expect(bag.count(CLOUD)).toBe(1);
    const rewards: number[] = [];
    for (let i = 0; i < 8; i++) rewards.push(puzzleReward(bag)!.kind);
    expect(rewards.slice(0, 5)).toEqual([MOON, SUN, DRAGON, STAR, MIRROR]);
    expect(bag.count(STARLIGHT)).toBe(99);
  });

  it('all full gives null and changes nothing', () => {
    const bag = new FakeBag(Object.fromEntries(S.order.map(id => [id, 99])));
    const before = bag.snapshot();
    expect(puzzleReward(bag)).toBeNull();
    expect(bag.snapshot()).toBe(before);
  });
});

describe('recordSolve', () => {
  it('counts solved always and clean only for clean solves, and never lowers anything', () => {
    const w = newWizardState();
    recordSolve(w, { clean: () => true });
    recordSolve(w, { clean: () => false });
    recordSolve(w, { clean: () => true });
    expect(w.solved).toBe(3);
    expect(w.clean).toBe(2);
    let prev = { ...w };
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      recordSolve(w, { clean: () => rng() < 0.5 });
      expect(w.solved).toBeGreaterThan(prev.solved);
      expect(w.clean).toBeGreaterThanOrEqual(prev.clean);
      prev = { ...w };
    }
  });

  it('a damaged counter starts again from nothing rather than staying broken', () => {
    const w = { ...newWizardState(), solved: Number.NaN, clean: -3 };
    recordSolve(w, { clean: () => true });
    expect(w.solved).toBe(1);
    expect(w.clean).toBe(1);
  });
});

describe('nothing is ever lost', () => {
  it('no trade path can reduce a block stack or touch any other item than gems', () => {
    const others = { [BlockId.Planks]: 7, [BlockId.Lamp]: 2, 104: 5, 108: 3 };
    const rng = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const bag = new FakeBag({ ...others, [GEM]: Math.floor(rng() * 6) });
      for (const id of S.order) bag.counts.set(id, Math.floor(rng() * 100));
      const blocksBefore = S.order.map(id => bag.count(id));
      const kind = S.order[Math.floor(rng() * 8)]!;
      const which = Math.floor(rng() * 3);
      if (which === 0) buy(bag, kind);
      else if (which === 1) claimGift(bag, kind, newWizardState());
      else puzzleReward(bag);
      S.order.forEach((id, j) => expect(bag.count(id)).toBeGreaterThanOrEqual(blocksBefore[j]!));
      for (const [id, n] of Object.entries(others)) expect(bag.count(Number(id))).toBe(n);
      for (const id of S.order) expect(bag.count(id)).toBeLessThanOrEqual(99);
    }
  });

  it('the sum of everything is conserved over 1,000 random trades', () => {
    const rng = mulberry32(2026);
    const bag = new FakeBag({ [GEM]: 40 });
    let gemsSpent = 0;
    let blocksGot = 0;
    for (let i = 0; i < 1000; i++) {
      if (rng() < 0.2) bag.add(GEM, Math.floor(rng() * 4)); // a grump was cheered up
      const gemsBefore = bag.count(GEM);
      const blocksBefore = S.order.reduce((s, id) => s + bag.count(id), 0);
      const kind = S.order[Math.floor(rng() * 8)]!;
      const r = buy(bag, kind);
      const gemsAfter = bag.count(GEM);
      const blocksAfter = S.order.reduce((s, id) => s + bag.count(id), 0);
      if (r.ok) {
        expect(gemsBefore - gemsAfter).toBe(S.price[kind]);
        expect(blocksAfter - blocksBefore).toBe(S.bundle);
        gemsSpent += r.spent;
        blocksGot += r.got;
      } else {
        expect(gemsAfter).toBe(gemsBefore);
        expect(blocksAfter).toBe(blocksBefore);
      }
    }
    expect(S.order.reduce((s, id) => s + bag.count(id), 0)).toBe(blocksGot);
    expect(gemsSpent).toBeGreaterThan(0);
  });
});

describe('works with the real Inventory', () => {
  // Stand-in ids that exist today, so the real bag's 99 cap and registry are exercised.
  const real: WizardStock = {
    order: [BlockId.Glass, BlockId.Bricks, BlockId.Lamp, BlockId.Planks, BlockId.WoolRed, BlockId.WoolBlue, BlockId.WoolWhite, BlockId.WoolYellow],
    price: { [BlockId.Glass]: 2, [BlockId.Bricks]: 1, [BlockId.Lamp]: 1, [BlockId.Planks]: 1, [BlockId.WoolRed]: 1, [BlockId.WoolBlue]: 2, [BlockId.WoolWhite]: 2, [BlockId.WoolYellow]: 2 },
    bundle: 4,
    gem: ItemId.Egg,
  };

  it('buy, gift and reward against Inventory', () => {
    const inv = new Inventory();
    inv.add(ItemId.Egg, 3);
    expect(buy(inv, BlockId.Glass, undefined, real)).toEqual({ ok: true, got: 4, spent: 2 });
    expect(inv.count(BlockId.Glass)).toBe(4);
    expect(inv.count(ItemId.Egg)).toBe(1);
    inv.add(BlockId.Bricks, 97);
    expect(buy(inv, BlockId.Bricks, undefined, real)).toEqual({ ok: false, why: 'bagFull' });
    expect(inv.count(ItemId.Egg)).toBe(1);
    const w = newWizardState();
    expect(claimGift(inv, BlockId.Lamp, w, real).ok).toBe(true);
    expect(puzzleReward(inv, real)).toEqual({ kind: BlockId.Planks, n: 1 });
  });
});
