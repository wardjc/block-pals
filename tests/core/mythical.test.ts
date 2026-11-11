import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId, dropFor, isCarriable } from '../../src/core/blocks';
import { isStackId } from '../../src/core/items';
import { BUNDLE, isMythical, MYTHICAL, PRICE, rewardKind } from '../../src/core/mythical';
import { canCollect, canPlace } from '../../src/core/placement';
import { RECIPES } from '../../src/core/recipes';
import { World } from '../../src/core/world';

const PINNED: Record<string, number> = {
  StarlightCrystal: 40, RainbowBlock: 41, CloudBlock: 42, MoonBlock: 43,
  SunBlock: 44, DragonScaleBlock: 45, StarBlock: 46, MagicMirror: 47,
};
const names = BlockId as unknown as Record<string, number>;

describe('mythical block ids', () => {
  test('ids 40..47 are pinned and 0..35 are unchanged', () => {
    for (const [name, id] of Object.entries(PINNED)) {
      expect(names[name]).toBe(id);
      expect(BLOCKS[id as BlockId].id).toBe(id);
    }
    // The older ids (snapshot also in world.test.ts).
    expect(BlockId.Bedrock).toBe(11);
    expect(BlockId.Lamp).toBe(15);
    expect(BlockId.Farmland).toBe(16);
    expect(BlockId.Potato3).toBe(35);
  });

  test('36..39 and 48..55 are unused (spare), and nothing reaches the cave ids 56..71', () => {
    for (const id of [36, 37, 38, 39, 48, 49, 50, 51, 52, 53, 54, 55]) expect(Object.hasOwn(BLOCKS, id)).toBe(false);
    expect(Math.max(...Object.keys(BLOCKS).map(Number))).toBe(47);
  });

  test('MYTHICAL holds the eight in the fixed order', () => {
    expect(MYTHICAL).toEqual([
      BlockId.StarlightCrystal, BlockId.RainbowBlock, BlockId.CloudBlock, BlockId.MoonBlock,
      BlockId.SunBlock, BlockId.DragonScaleBlock, BlockId.StarBlock, BlockId.MagicMirror,
    ]);
  });
});

describe('mythical block definitions', () => {
  test('all eight are solid, collectable, carriable and placeable like Planks', () => {
    for (const id of MYTHICAL) {
      const def = BLOCKS[id];
      expect(def).toMatchObject({ id, solid: true, collectable: true });
      expect(def.shape ?? 'cube').toBe('cube');
      expect(isCarriable(id)).toBe(true);
      expect(isStackId(id)).toBe(true);
      expect(dropFor(id)).toBe(id);

      const w = new World(4, 4, 4);
      w.set(1, 0, 1, BlockId.Stone);
      expect(canPlace(w, [1, 1, 1], [], id)).toBe(canPlace(w, [1, 1, 1], [], BlockId.Planks));
      expect(canPlace(w, [1, 1, 1], [], id)).toBe(true);
      w.set(1, 1, 1, id);
      expect(canCollect(w, [1, 1, 1])).toBe(true);
      // Solid ground for the next block, like any other cube.
      expect(canPlace(w, [1, 2, 1], [], BlockId.Planks)).toBe(true);
    }
  });

  test('only Magic mirror is transparent (like Glass)', () => {
    expect(MYTHICAL.filter(id => BLOCKS[id].transparent)).toEqual([BlockId.MagicMirror]);
    const { id: _a, name: _b, icon: _c, ...mirror } = BLOCKS[BlockId.MagicMirror];
    const { id: _d, name: _e, icon: _f, ...glass } = BLOCKS[BlockId.Glass];
    expect({ solid: mirror.solid, collectable: mirror.collectable, transparent: mirror.transparent })
      .toEqual({ solid: glass.solid, collectable: glass.collectable, transparent: glass.transparent });
  });

  test('light flag is exactly Starlight, Moon and Sun', () => {
    const lit = (Object.values(BLOCKS)).filter(d => d.light).map(d => d.id);
    expect(lit).toEqual([BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock]);
  });

  test('shimmer flag is exactly Rainbow, Starlight, Star and Magic mirror', () => {
    const sh = (Object.values(BLOCKS)).filter(d => d.shimmer).map(d => d.id).sort((a, b) => a - b);
    expect(sh).toEqual([BlockId.StarlightCrystal, BlockId.RainbowBlock, BlockId.StarBlock, BlockId.MagicMirror]);
  });

  test('every mythical block has a simple name of at most 3 words and its own icon', () => {
    const icons = new Set<string>();
    for (const id of MYTHICAL) {
      const { name, icon } = BLOCKS[id];
      expect(name).toMatch(/^[a-z]+( [a-z]+){0,2}$/);
      icons.add(icon);
    }
    expect(icons.size).toBe(8);
  });

  test('no recipe produces or uses a mythical block', () => {
    for (const r of RECIPES) {
      expect(isMythical(r.output.id)).toBe(false);
      for (const input of r.inputs) expect(isMythical(input.id)).toBe(false);
    }
  });
});

describe('prices and rewards', () => {
  test('prices are 1 or 2, cheap ones are Cloud, Rainbow, Sun and Moon; every price and the bundle are 20 or fewer', () => {
    expect(BUNDLE).toBe(4);
    expect(BUNDLE).toBeLessThanOrEqual(20);
    const cheap = [BlockId.CloudBlock, BlockId.RainbowBlock, BlockId.SunBlock, BlockId.MoonBlock];
    for (const id of MYTHICAL) {
      expect(PRICE[id]).toBe(cheap.includes(id) ? 1 : 2);
      expect(PRICE[id]).toBeLessThanOrEqual(20);
    }
    expect(Object.keys(PRICE).length).toBe(8);
  });

  test('rewardKind picks the fewest held, ties in order', () => {
    expect(rewardKind(() => 0)).toBe(BlockId.StarlightCrystal);
    const held = new Map<BlockId, number>(MYTHICAL.map(id => [id, 5]));
    held.set(BlockId.SunBlock, 2);
    held.set(BlockId.StarBlock, 2);
    expect(rewardKind(id => held.get(id) ?? 0)).toBe(BlockId.SunBlock);
    held.set(BlockId.SunBlock, 3);
    expect(rewardKind(id => held.get(id) ?? 0)).toBe(BlockId.StarBlock);
  });

  test('rewardKind skips full stacks and is null when all are full', () => {
    const held = new Map<BlockId, number>(MYTHICAL.map(id => [id, 99]));
    expect(rewardKind(id => held.get(id) ?? 0)).toBeNull();
    held.set(BlockId.MagicMirror, 98);
    expect(rewardKind(id => held.get(id) ?? 0)).toBe(BlockId.MagicMirror);
    // A stack past the cap (should never happen) is treated as full too.
    held.set(BlockId.MagicMirror, 120);
    expect(rewardKind(id => held.get(id) ?? 0)).toBeNull();
    // A smaller cap.
    expect(rewardKind(() => 3, 3)).toBeNull();
    expect(rewardKind(id => (id === BlockId.CloudBlock ? 2 : 3), 3)).toBe(BlockId.CloudBlock);
  });

  test('isMythical accepts exactly 40..47 and rejects 35, 39, 48, the cave ids and non-integers', () => {
    for (const id of MYTHICAL) expect(isMythical(id)).toBe(true);
    for (const n of [0, 9, 15, 35, 39, 48, 56, 64, 123, -1, 40.5, NaN, Infinity]) expect(isMythical(n)).toBe(false);
  });
});
