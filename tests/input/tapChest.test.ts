import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { resolveHold, resolveTap } from '../../src/input/tap';

/** Chest taps (plan Task 19): one new tap target, and the old rules unchanged around it. */
function flatWorld(): World {
  const world = new World(12, 8, 12);
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) world.set(x, 0, z, BlockId.Grass);
  world.markClean();
  return world;
}

const feet: Cell = [2, 1, 2];
const occupied: Cell[] = [feet, [2, 2, 2], [3, 1, 2]];
const up: Cell = [0, 1, 0];
const SELECTIONS = ['hand', BlockId.Planks, BlockId.Wood, ItemId.WheatSeed, ItemId.AppleSapling, ItemId.Apple, ItemId.Carrot, ItemId.Gem] as const;

describe('the unchanged rules (spec 7a), kept green beside the chest rule', () => {
  it('a quick tap with the hand walks', () => {
    expect(resolveTap({ cell: [4, 0, 4], normal: up }, 'hand', feet, flatWorld(), occupied)).toEqual({ kind: 'walk', to: [4, 1, 4] });
  });
  it('a quick tap with a block builds in reach', () => {
    expect(resolveTap({ cell: [4, 0, 4], normal: up }, BlockId.Planks, feet, flatWorld(), occupied)).toEqual({ kind: 'place', cell: [4, 1, 4] });
  });
  it('a tap never digs', () => {
    const world = flatWorld();
    world.set(4, 1, 4, BlockId.Chest);
    world.set(5, 1, 5, BlockId.GemOre);
    world.markClean();
    for (const sel of SELECTIONS) {
      for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) {
        const kind = resolveTap({ cell: [x, world.topSolidY(x, z), z], normal: up }, sel, feet, world, occupied).kind;
        expect(['walk', 'place', 'plant', 'help', 'open', 'walkNear', 'none']).toContain(kind);
      }
    }
    expect(world.isDirty()).toBe(false);
  });
  it('hold digs within reach', () => {
    const world = flatWorld();
    world.set(4, 1, 4, BlockId.Stone);
    expect(resolveHold({ cell: [4, 1, 4], normal: up }, feet, world, occupied)).toEqual({ kind: 'dig', cell: [4, 1, 4] });
  });
  it('hold on the block under his or Pip\'s feet does nothing', () => {
    const world = flatWorld();
    expect(resolveHold({ cell: [2, 0, 2], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
    expect(resolveHold({ cell: [3, 0, 2], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
  });
});

describe('a tap on a chest', () => {
  const chestWorld = (at: Cell = [4, 1, 4], id = BlockId.Chest): World => {
    const w = flatWorld();
    w.set(...at, id);
    w.markClean();
    return w;
  };

  it.each(SELECTIONS)('a closed chest in reach opens with %s selected', sel => {
    for (const normal of [up, [1, 0, 0], [-1, 0, 0], [0, 0, -1]] as Cell[]) {
      expect(resolveTap({ cell: [4, 1, 4], normal }, sel, feet, chestWorld(), occupied)).toEqual({ kind: 'open', cell: [4, 1, 4] });
    }
  });

  it('a tap on a closed chest never builds against it', () => {
    for (const sel of SELECTIONS) {
      const kind = resolveTap({ cell: [4, 1, 4], normal: up }, sel, feet, chestWorld(), occupied).kind;
      expect(kind).not.toBe('place');
      expect(kind).not.toBe('plant');
    }
  });

  it('a closed chest out of reach walks beside it; nothing opens', () => {
    for (const sel of SELECTIONS) {
      expect(resolveTap({ cell: [9, 1, 9], normal: up }, sel, feet, chestWorld([9, 1, 9]), occupied)).toEqual({ kind: 'walkNear', block: [9, 1, 9] });
    }
  });

  it('a hold on a closed chest does nothing, near or far', () => {
    expect(resolveHold({ cell: [4, 1, 4], normal: up }, feet, chestWorld(), occupied)).toEqual({ kind: 'none' });
    expect(resolveHold({ cell: [9, 1, 9], normal: up }, feet, chestWorld([9, 1, 9]), occupied)).toEqual({ kind: 'none' });
  });

  it('a tap on an open chest behaves as on any block', () => {
    const w = chestWorld([4, 1, 4], BlockId.ChestOpen);
    expect(resolveTap({ cell: [4, 1, 4], normal: up }, BlockId.Planks, feet, w, occupied)).toEqual({ kind: 'place', cell: [4, 2, 4] });
    expect(resolveTap({ cell: [4, 1, 4], normal: up }, 'hand', feet, w, occupied)).toEqual({ kind: 'walk', to: [4, 2, 4] });
    expect(resolveHold({ cell: [4, 1, 4], normal: up }, feet, w, occupied)).toEqual({ kind: 'dig', cell: [4, 1, 4] });
  });

  it('the wizard and an animal under the finger still come first', () => {
    const w = chestWorld();
    expect(resolveTap({ cell: [4, 1, 4], normal: up }, 'hand', feet, w, occupied, { wizardHit: { dist: 2, cell: [5, 1, 5] } }).kind).toBe('talk');
    expect(resolveTap({ cell: [4, 1, 4], normal: up }, 'hand', feet, w, occupied, { animalHit: { id: 3, dist: 1 } }).kind).toBe('pet');
  });
});
