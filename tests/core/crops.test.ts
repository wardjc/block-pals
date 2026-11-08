import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { canPlant, cropBlock, cropOf, cue, growthRateAt, seedFor, yields, type CropKind } from '../../src/core/crops';
import { ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';

const KINDS: CropKind[] = ['wheat', 'carrot', 'potato'];

describe('crops', () => {
  it('cropBlock and cropOf round-trip for all 12 ids', () => {
    for (const kind of KINDS) {
      for (let stage = 0; stage < 4; stage++) {
        expect(cropOf(cropBlock(kind, stage))).toEqual({ kind, stage });
      }
    }
  });
  it('the sapling is apple stage 0 and other blocks are not crops', () => {
    expect(cropOf(BlockId.Sapling)).toEqual({ kind: 'apple', stage: 0 });
    expect(cropOf(BlockId.Grass)).toBeNull();
    expect(cropOf(BlockId.Farmland)).toBeNull();
  });
  it('seedFor maps every kind', () => {
    expect(seedFor('wheat')).toBe(ItemId.WheatSeed);
    expect(seedFor('carrot')).toBe(ItemId.CarrotSeed);
    expect(seedFor('potato')).toBe(ItemId.PotatoSeed);
    expect(seedFor('apple')).toBe(ItemId.AppleSapling);
  });
  it('yields never empty and always include a seed', () => {
    for (const kind of [...KINDS, 'apple' as const]) {
      for (let stage = 0; stage < 4; stage++) {
        const y = yields(kind, stage);
        expect(y.length).toBeGreaterThan(0);
        expect(y.some(g => g.id === seedFor(kind) && g.n >= 1)).toBe(true);
      }
    }
  });
  it('an unripe pull returns exactly one seed', () => {
    for (const kind of KINDS) for (const stage of [0, 1, 2]) expect(yields(kind, stage)).toEqual([{ id: seedFor(kind), n: 1 }]);
  });
  it('ripe crops give 2 food and 2 seeds; apples 2 apples and 1 sapling', () => {
    expect(yields('carrot', 3)).toEqual([{ id: ItemId.Carrot, n: 2 }, { id: ItemId.CarrotSeed, n: 2 }]);
    expect(yields('wheat', 3)).toEqual([{ id: ItemId.Wheat, n: 2 }, { id: ItemId.WheatSeed, n: 2 }]);
    expect(yields('potato', 3)).toEqual([{ id: ItemId.Potato, n: 2 }, { id: ItemId.PotatoSeed, n: 2 }]);
    expect(yields('apple', 3)).toEqual([{ id: ItemId.Apple, n: 2 }, { id: ItemId.AppleSapling, n: 1 }]);
  });
  it('cue sequence is water, sun, both', () => {
    expect([0, 1, 2].map(cue)).toEqual(['water', 'sun', 'both']);
  });
  it('growth rate is 1 today', () => {
    expect(growthRateAt(new World(4, 4, 4), [1, 1, 1])).toBe(1);
  });
});

describe('canPlant', () => {
  function floor(ground: BlockId): World {
    const w = new World(8, 8, 8);
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) w.set(x, 0, z, ground);
    return w;
  }
  it.each([BlockId.Grass, BlockId.Dirt, BlockId.Farmland])('accepts %i with air above', ground => {
    expect(canPlant(floor(ground), [3, 1, 3], [])).toBe(true);
  });
  it.each([BlockId.Sand, BlockId.PathStone, BlockId.Planks, BlockId.Stone])('refuses %i', ground => {
    expect(canPlant(floor(ground), [3, 1, 3], [])).toBe(false);
  });
  it('refuses an occupied cell, an existing plant, no room above and an out-of-bounds cell', () => {
    const w = floor(BlockId.Grass);
    expect(canPlant(w, [3, 1, 3], [[3, 1, 3]])).toBe(false);
    expect(canPlant(w, [3, 1, 3], [[3, 2, 3]])).toBe(true);
    w.set(3, 1, 3, BlockId.Wheat1);
    expect(canPlant(w, [3, 1, 3], [])).toBe(false);
    w.set(5, 2, 5, BlockId.Planks);
    expect(canPlant(w, [5, 1, 5], [])).toBe(false);
    expect(canPlant(w, [20, 1, 3], [])).toBe(false);
  });
});
